import type { PlanuEvent } from "../../lib/types.js";

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

/**
 * What's needed to save an event from the editor. Firebase is a detail of
 * `infrastructure/`: `event-editor.ts` shouldn't know about `Timestamp`,
 * `doc`, `setDoc`, or `addDoc`.
 *
 * Scoped to what the editor needs today — create and edit — not a mirror
 * of `firebase/firestore`. Widening this shape is legitimate the day
 * another use case needs it; not before.
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
}
