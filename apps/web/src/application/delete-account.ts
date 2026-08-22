import type { AccountDataPort } from "./ports/account-data.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

/**
 * Progress reported at each step, so the UI can say what's happening instead
 * of a mute spinner — T32 warns that shared events disappear for the people
 * invited to them, and seeing "deleting 3 of 7 events" is what makes that
 * warning credible while it's happening.
 */
export type DeleteAccountStep =
	| { phase: "listing" }
	| { phase: "deleting-events"; done: number; total: number }
	| { phase: "deleting-directory" }
	| { phase: "deleting-account" };

/**
 * Deletes the account and everything it owns, in the order T32 fixes: owned
 * events and their images, the directory entry, membership in events owned
 * by someone else, and finally the Auth account.
 *
 * **Genuinely resumable, not just "can be called again."** Every step is a
 * Firestore/Storage/Auth operation that's already idempotent on its own:
 * deleting a document that no longer exists doesn't fail, and neither does
 * `leaveEvent` on an event the account is no longer a member of — the same
 * reason `leavesTheEvent()` in the rules requires `isMember()`, which stops
 * holding the second time without that being an error. So a retry after a
 * mid-flight interruption — dropped connection, closed tab — just lists
 * what's left and continues: no separate checkpoint ever has to remember
 * where it stopped.
 *
 * The order matters for a reason that isn't just aesthetic: the event and
 * its image are deleted *before* the Auth account itself, because
 * `deleteEventImage` and `deleteOwnEvent` authorize via `isOwner()` — the
 * session's uid — and that session stops existing the moment
 * `deleteAccount()` resolves. Reversing the order would orphan events and
 * images with no account left able to delete them.
 */
export async function deleteAccount(
	session: SessionPort,
	account: AccountDataPort,
	user: SessionUser,
	onProgress?: (step: DeleteAccountStep) => void,
): Promise<void> {
	onProgress?.({ phase: "listing" });
	const events = await account.listMemberEvents(user.uid);

	for (const [index, event] of events.entries()) {
		onProgress?.({
			phase: "deleting-events",
			done: index,
			total: events.length,
		});

		if (event.isOwner) {
			if (event.imageUrl) await account.deleteEventImage(event.imageUrl);
			await account.deleteOwnEvent(event.id);
		} else {
			await account.leaveEvent(event.id, user.uid);
		}
	}

	onProgress?.({ phase: "deleting-directory" });
	await account.deleteDirectoryEntries(user.uid, user.email);

	// The one step that can demand reauthentication: Firestore and Storage
	// don't, `deleteUser()` does. Left to propagate unwrapped — a
	// `SessionError` with code `"requires-recent-login"` if the session is
	// stale — because the caller is the one who decides to reauthenticate
	// and retry; everything else in this use case is already deleted by the
	// time this happens, so a retry lists (empty) and lands here directly.
	onProgress?.({ phase: "deleting-account" });
	await session.deleteAccount();
}
