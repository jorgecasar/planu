import type { EventRole, PlanuEvent } from "../../lib/types.js";

/** What `create()` resolves with. */
export interface CreatedEvent {
	id: string;
	/**
	 * Whether the owner had zero visible events right before this write.
	 * T31's `trackFirstEventCreated()` needs it, and the count it depends
	 * on — `getCountFromServer` against the same `memberIds` query the
	 * listing uses — is a Firestore detail: the editor shouldn't have to
	 * know how "first event" gets decided, only whether it happened.
	 */
	wasFirstEvent: boolean;
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
	 * Deletes an event.
	 *
	 * Only the owner (or an invited editor with `canDelete`) should call
	 * this. The rules enforce authorization; this port just executes.
	 */
	delete(id: string): Promise<void>;

	/**
	 * Lists events for a member. The query shape is fixed by the rules:
	 * `memberIds array-contains uid`. The repository decides the ordering.
	 */
	listFor(uid: string): AsyncIterable<StoredEvent>;

	/**
	 * Updates an event's `memberIds` and `roles` — used when a guest leaves.
	 *
	 * The caller must compute the new `memberIds` and `roles` after removing
	 * their own uid. The rules enforce that only the leaving user's entry
	 * is removed; this port just executes the write.
	 */
	updateMembership(
		id: string,
		memberIds: string[],
		roles: Record<string, EventRole>,
	): Promise<void>;
}
