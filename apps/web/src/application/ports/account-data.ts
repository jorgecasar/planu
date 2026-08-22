import { createContext } from "@lit/context";

/**
 * What T32 needs to touch in Firestore and Storage to delete an account, on
 * the domain side.
 *
 * Not a general events port: it is deliberately narrow, with only the five
 * steps `deleteAccount()` runs in order — own event, image, directory, guest
 * membership. Widening it the day another use case needs more is fine; not
 * before.
 */

/** The minimum an event needs to expose for deletion to work. */
export interface AccountEventSummary {
	id: string;
	/** `true` if this account owns the event; `false` if it's just a member. */
	isOwner: boolean;
	/** Present only if an owned event has a cover image to delete. */
	imageUrl?: string;
}

export interface AccountDataPort {
	/**
	 * Every event where the account appears in `memberIds` — owned and
	 * guest. It's the only queryable shape the rules allow on `events`
	 * (`memberIds array-contains`, not `userId ==`); see `events-view.ts` for
	 * the same pattern.
	 */
	listMemberEvents(uid: string): Promise<AccountEventSummary[]>;

	/** Deletes an entire owned event. */
	deleteOwnEvent(eventId: string): Promise<void>;

	/** Removes the account from `memberIds`/`roles` of a guest event, nothing else. */
	leaveEvent(eventId: string, uid: string): Promise<void>;

	/** Deletes an owned event's cover image, if `imageUrl` pointed to one. */
	deleteEventImage(imageUrl: string): Promise<void>;

	/** Deletes the account's `userDirectory` and `userProfiles` entries. */
	deleteDirectoryEntries(uid: string, email: string | null): Promise<void>;
}

/**
 * The port's Lit context. No safe no-op default like `analyticsContext`'s:
 * there's no harmless way to satisfy a delete-account call, so the value
 * stays `undefined` until the composition root has both Firestore and
 * Storage ready — same shape as `sessionContext`.
 */
export const accountDataContext = createContext<AccountDataPort | undefined>(
	Symbol("planu-account-data"),
);
