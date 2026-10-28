/**
 * `SharingPort` adapter: the one file, along with its test, that knows
 * inviting, listing and managing an event's people touches Firestore.
 *
 * Moved here from `sharing/user-directory.ts`, which used to call Firestore
 * directly — see docs/adr/0007-client-side-user-directory.md for why a
 * client-side directory exists at all. `sharing/invitations.ts` stays where
 * it is and keeps its own `firebase/**` exemption: it is not this task's
 * scope, and `inviteToEvent`/`revokeInvite` below just call straight through
 * to it with the `Firestore` instance this adapter already holds.
 */

import {
	collection,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import type { SessionUser } from "../../application/ports/session.js";
import type {
	DirectoryEntry,
	InviteOffer,
	PendingInviteSummary,
	PublicProfile,
	SharingPort,
} from "../../application/ports/sharing.js";
import type { EventRole } from "../../lib/types.js";
import { recordBackgroundWrite } from "../../observability/index.js";
import {
	INVITES_COLLECTION,
	inviteId,
	inviteToEvent as inviteToEventInCollection,
	revokeInvite as revokeInviteInCollection,
} from "../../sharing/invitations.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PENDING_INVITES_BY_EMAIL_COLLECTION,
	PROFILES_COLLECTION,
} from "../../sharing/user-directory.js";

/**
 * Classifies a caught failure for {@link recordBackgroundWrite}.
 *
 * Duck-typed on `.code` rather than `error instanceof FirebaseError`
 * (`firebase/app`'s own class, the pattern `session-adapter.ts` uses):
 * importing that class here would add a real `firebase/app` import to this
 * module's test for no gain — a rejected Firestore promise carries a `.code`
 * regardless of which class instance it is.
 *
 * Only two categories matter: whether the rule engine itself said no, or
 * anything else — offline, a timeout, anything unclassified.
 */
function outcomeOf(error: unknown): "permission-denied" | "failure" {
	const code =
		typeof error === "object" && error !== null && "code" in error
			? (error as { code: unknown }).code
			: undefined;
	return code === "permission-denied" ? "permission-denied" : "failure";
}

/** The shape a pending-by-email offer is stored in. */
interface PendingInviteByEmail {
	eventTitle: string;
	inviteeEmail: string;
	invitedBy: string;
	invitedByName?: string;
	role: EventRole;
}

export function createSharingAdapter(firestore: Firestore): SharingPort {
	return {
		async findUserByEmail(email: string): Promise<DirectoryEntry | null> {
			const snapshot = await getDoc(
				doc(firestore, DIRECTORY_COLLECTION, await emailHash(email)),
			);
			return snapshot.exists() ? (snapshot.data() as DirectoryEntry) : null;
		},

		async findProfiles(
			uids: readonly string[],
		): Promise<Map<string, PublicProfile>> {
			const entries = await Promise.all(
				uids.map(async (uid) => {
					const snapshot = await getDoc(
						doc(firestore, PROFILES_COLLECTION, uid),
					).catch(() => null);

					return snapshot?.exists()
						? ([uid, snapshot.data() as PublicProfile] as const)
						: null;
				}),
			);

			return new Map(entries.filter((entry) => entry !== null));
		},

		async listPendingInvites(
			eventId: string,
			invitedBy: string,
		): Promise<PendingInviteSummary[]> {
			const snapshot = await getDocs(
				query(
					collection(firestore, INVITES_COLLECTION),
					where("invitedBy", "==", invitedBy),
					where("eventId", "==", eventId),
					where("status", "==", "pending"),
				),
			);

			return snapshot.docs.map((row) => {
				const data = row.data();
				return {
					id: row.id,
					eventId: String(data["eventId"] ?? ""),
					inviteeUid: String(data["inviteeUid"] ?? ""),
					inviteeEmail: String(data["inviteeEmail"] ?? ""),
					role: (data["role"] === "editor" ? "editor" : "viewer") as EventRole,
				};
			});
		},

		async inviteToEvent(
			invite: InviteOffer & { inviteeUid: string },
		): Promise<void> {
			await inviteToEventInCollection(firestore, invite);
		},

		/**
		 * The twin of `inviteToEvent()`, for an email with no account yet.
		 *
		 * Firebase Auth exposes no directory to turn an email into a uid, so
		 * there is no uid to point an `eventInvites` document at. This parks
		 * the offer in {@link PENDING_INVITES_BY_EMAIL_COLLECTION} instead, at
		 * the deterministic id `eventId + '_' + emailHash(inviteeEmail)` that
		 * `isValidPendingInvite()` in `firestore.rules` requires. Whoever later
		 * registers with that address and verifies it can turn this into a
		 * normal `eventInvites` document — see `claimPendingInvitesByEmail`
		 * below.
		 *
		 * Deliberately not a mirror of `inviteToEvent()`'s re-offer handling:
		 * the rules grant only `create`, `read` and `delete` on this
		 * collection, no `update`. Calling this twice for the same event and
		 * email is therefore not the safe retry that re-inviting a known uid
		 * is — the second `setDoc` targets a document that already exists,
		 * which Firestore evaluates as an update, and no rule allows that, so
		 * it fails. `share-dialog.ts` does not yet expose a way to trigger
		 * that twice for the same address, so this is a documented limit
		 * rather than a handled case.
		 */
		async offerInviteByEmail(offer: InviteOffer): Promise<void> {
			await setDoc(
				doc(
					firestore,
					PENDING_INVITES_BY_EMAIL_COLLECTION,
					`${offer.eventId}_${await emailHash(offer.inviteeEmail)}`,
				),
				{
					eventId: offer.eventId,
					eventTitle: offer.eventTitle,
					inviteeEmail: offer.inviteeEmail,
					invitedBy: offer.invitedBy,
					invitedByName: offer.invitedByName,
					role: offer.role,
					createdAt: serverTimestamp(),
				},
			);
		},

		async changeInviteRole(id: string, role: EventRole): Promise<void> {
			await updateDoc(doc(firestore, INVITES_COLLECTION, id), { role });
		},

		async revokeInvite(id: string): Promise<void> {
			await revokeInviteInCollection(firestore, { id });
		},

		async updateEventMembership(
			eventId: string,
			membership: { memberIds: string[]; roles: Record<string, EventRole> },
		): Promise<void> {
			await updateDoc(doc(firestore, "events", eventId), membership);
		},

		/**
		 * **Only if the email is verified.** Firebase Auth happily lets anyone
		 * register with any address, so without this condition signing up with
		 * someone else's email would be enough to collect their invitations.
		 * The rule enforces it anyway; this just avoids a write that was going
		 * to bounce.
		 *
		 * Every attempt is recorded via `recordBackgroundWrite()` (T65),
		 * distinguishing success from a rule denial from anything else. Neither
		 * this function's return value nor what it throws changes because of
		 * it: both call sites already swallow the rejection this still
		 * produces on failure (`firebase-provider.ts`, `profile-view.ts`), and
		 * that stays exactly as silent as before. This only makes the silence
		 * honest instead of blind.
		 */
		async publishDirectoryEntry(user: SessionUser): Promise<void> {
			if (!user.email || !user.emailVerified) return;

			const entry: DirectoryEntry = {
				uid: user.uid,
				displayName: user.displayName ?? "",
				photoURL: user.photoURL ?? "",
			};

			try {
				await Promise.all([
					setDoc(
						doc(firestore, DIRECTORY_COLLECTION, await emailHash(user.email)),
						entry,
					),
					setDoc(doc(firestore, PROFILES_COLLECTION, user.uid), {
						displayName: entry.displayName,
						photoURL: entry.photoURL,
					}),
				]);
			} catch (error) {
				recordBackgroundWrite("publishDirectoryEntry", outcomeOf(error), error);
				throw error;
			}

			recordBackgroundWrite("publishDirectoryEntry", "success");
		},

		/**
		 * **Only if the caller's email is verified** — same reasoning as
		 * `publishDirectoryEntry`: an unverified account cannot prove it owns
		 * the address an offer names, and the rule (`claimsPendingByEmail()`)
		 * denies it anyway.
		 *
		 * ## Why `candidateEventIds`, not discovery
		 *
		 * `eventInvitesByEmail` denies an unfiltered `list`, deliberately and
		 * for the same reason {@link DIRECTORY_COLLECTION} does (see
		 * docs/adr/0007-client-side-user-directory.md): without that
		 * restriction, any signed-in account could enumerate every pending
		 * offer in the collection, not just its own. Only the owner's own
		 * `invitedBy` query passes; the invitee still cannot list. That closes
		 * the census, but it also removes the only mechanism this function
		 * could otherwise use to find out *which* `eventId`s carry an offer
		 * for the caller's address — the document id encodes the `eventId`, so
		 * it is checkable one at a time with a `get()`, never listed.
		 *
		 * Today, **neither of this function's two real call sites has an
		 * `eventId` in scope**: `firebase-provider.ts`'s `onAuthStateChanged`
		 * handler and `profile-view.ts`'s "I have verified it" button both
		 * fire globally, not from a page that names one event. Called from
		 * either site with no third argument, `candidateEventIds` defaults to
		 * empty and this is a **documented no-op today**: the loop below has
		 * nothing to iterate over, so no pending offer is ever claimed by
		 * either real caller yet.
		 *
		 * That no-op is recorded honestly (T65), not as a disguised success:
		 * called with no candidates, this reports `"skipped"` via
		 * `recordBackgroundWrite()` — "no candidates to check" — rather than
		 * `"success"`, which would claim an attempt that never happened. When
		 * candidates *are* supplied, the actual write attempt is recorded as
		 * `"success"`, `"permission-denied"`, or `"failure"` instead.
		 *
		 * When a candidate *is* supplied, only the offer whose id matches the
		 * caller's own verified email can ever be found: the id this function
		 * builds is `eventId + '_' + emailHash(user.email)`, from the caller's
		 * own token, never from anything supplied by whoever calls this. The
		 * check against the fetched document's own `inviteeEmail` below is
		 * redundant with what the rule already pins
		 * (`isValidPendingInvite()`'s
		 * `inviteId == d.eventId + '_' + emailHash(d.inviteeEmail)`) — kept
		 * only as the same belt-and-suspenders this codebase already applies
		 * elsewhere (`isOwnEmail()` vs. `isOwnEmailForId()` in
		 * `firestore.rules`), never as the only thing standing between a claim
		 * and the wrong email.
		 */
		async claimPendingInvitesByEmail(
			user: SessionUser,
			candidateEventIds: readonly string[] = [],
		): Promise<void> {
			if (!user.email || !user.emailVerified) return;

			if (candidateEventIds.length === 0) {
				// Honest, not a disguised success: this call attempted nothing,
				// which is today's documented state at both real call sites.
				recordBackgroundWrite(
					"claimPendingInvitesByEmail",
					"skipped",
					"no candidates to check",
				);
				return;
			}

			const ownEmail = user.email.trim().toLowerCase();
			const hash = await emailHash(user.email);

			try {
				await Promise.all(
					candidateEventIds.map(async (eventId) => {
						const offerRef = doc(
							firestore,
							PENDING_INVITES_BY_EMAIL_COLLECTION,
							`${eventId}_${hash}`,
						);
						const offer = await getDoc(offerRef);
						if (!offer.exists()) return;

						const data = offer.data() as PendingInviteByEmail;
						if (data.inviteeEmail.trim().toLowerCase() !== ownEmail) return;

						const batch = writeBatch(firestore);
						batch.delete(offerRef);
						batch.set(
							doc(firestore, INVITES_COLLECTION, inviteId(eventId, user.uid)),
							{
								eventId,
								eventTitle: data.eventTitle,
								inviteeUid: user.uid,
								inviteeEmail: data.inviteeEmail,
								invitedBy: data.invitedBy,
								invitedByName: data.invitedByName ?? "",
								role: data.role,
								status: "pending",
								createdAt: serverTimestamp(),
								decidedAt: null,
							},
						);
						await batch.commit();
					}),
				);
			} catch (error) {
				recordBackgroundWrite(
					"claimPendingInvitesByEmail",
					outcomeOf(error),
					error,
				);
				throw error;
			}

			recordBackgroundWrite("claimPendingInvitesByEmail", "success");
		},
	};
}
