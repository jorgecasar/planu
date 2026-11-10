import type { PlanuEvent } from "../../lib/types.js";

/** What `create()` resolves with. */
export interface CreatedEvent {
	id: string;
}

/** An event already read from the repository, with its identifier. */
export interface StoredEvent extends PlanuEvent {
	id: string;
}

/**
 * What's needed to save and list events. Firebase is a detail of
 * `infrastructure/`: components shouldn't know about `Timestamp`,
 * `doc`, `setDoc`, or `addDoc`.
 *
 * Scoped to what the editor and views need today — create, edit, list —
 * not a mirror of `firebase/firestore`. Widening this shape is legitimate
 * the day another use case needs it; not before.
 */
export interface EventRepositoryPort {
	/**
	 * Creates a new event with its creator as its sole member.
	 */
	create(values: PlanuEvent, ownerUid: string): Promise<CreatedEvent>;

	/**
	 * Updates an existing event's content.
	 *
	 * Content only: it doesn't touch `userId`, `memberIds`, or `roles`.
	 * Resending the editor's uid would cost an invited editor their
	 * permission — to the rules that's transferring ownership — and
	 * membership is the share dialog's job, not this port's.
	 */
	update(id: string, values: PlanuEvent): Promise<void>;

	/**
	 * Deletes the event outright. Whether the caller is allowed to — only the
	 * owner is, see `canDelete()` in `sharing/permissions.ts` and the matching
	 * `firestore.rules` clause — is a UI/rules concern, not this port's.
	 */
	delete(id: string): Promise<void>;

	/**
	 * Removes `uid` from the event's `memberIds` and `roles`, and nothing
	 * else — the way a guest leaves an event that isn't theirs.
	 *
	 * Not a narrower `update()`: `update()` is barred from ever touching
	 * membership, and this is the one write that touches only membership,
	 * scoped to the caller's own uid. See ADR 0006 and `leavesTheEvent()` in
	 * `firestore.rules`.
	 */
	leave(id: string, uid: string): Promise<void>;
}
