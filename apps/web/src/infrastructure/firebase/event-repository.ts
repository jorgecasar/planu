import {
	addDoc,
	arrayRemove,
	collection,
	deleteDoc,
	deleteField,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	Timestamp,
	where,
	writeBatch,
} from "firebase/firestore";
import type {
	CreatedEvent,
	EventRepositoryPort,
} from "../../application/ports/event-repository.js";
import type { PlanuEvent } from "../../lib/types.js";
import {
	INVITES_COLLECTION,
	inviteId,
	inviteTombstone,
} from "../../sharing/invitations.js";
import { PENDING_INVITES_BY_EMAIL_COLLECTION } from "../../sharing/user-directory.js";

/** Firestore caps a batch at 500 writes; stay well under it. */
const DELETE_BATCH_SIZE = 450;

/**
 * From `PlanuEvent` to what Firestore accepts: dates become `Timestamp`.
 * Exported so it can be unit-tested without an emulator, the way
 * `session-adapter.ts`/`analytics-adapter.ts` test their own translation
 * logic.
 */
export function toContent(values: PlanuEvent) {
	return {
		title: values.title,
		description: values.description ?? "",
		location: values.location ?? "",
		imageUrl: values.imageUrl ?? "",
		startDate: values.startDate ? Timestamp.fromDate(values.startDate) : null,
		endDate: values.endDate ? Timestamp.fromDate(values.endDate) : null,
		allDay: values.allDay,
		tags: values.tags,
	};
}

/**
 * The only event-repository adapter the editor and views use: they know
 * `EventRepositoryPort`, not `Firestore`.
 */
export class FirebaseEventRepository implements EventRepositoryPort {
	readonly #firestore: Firestore;

	constructor(firestore: Firestore) {
		this.#firestore = firestore;
	}

	async create(values: PlanuEvent, ownerUid: string): Promise<CreatedEvent> {
		// An event is born with its creator as sole member and no guests: the
		// rules reject any other way of starting.
		const created = await addDoc(collection(this.#firestore, "events"), {
			...toContent(values),
			userId: ownerUid,
			memberIds: [ownerUid],
			roles: {},
			createdAt: serverTimestamp(),
		});
		return { id: created.id };
	}

	async update(id: string, values: PlanuEvent): Promise<void> {
		// Editing sends content only. Resending the editor's uid would cost an
		// invited editor their permission, because to the rules that is
		// transferring ownership; and membership is not touched from here, which
		// is what the share dialog is for.
		await setDoc(doc(this.#firestore, "events", id), toContent(values), {
			merge: true,
		});
	}

	async delete(id: string, ownerUid: string): Promise<void> {
		await deleteDoc(doc(this.#firestore, "events", id));
		// Cleanup runs after the event is gone, never in the same batch: the rules
		// let the owner delete invitations and offers only once the event no longer
		// exists. The event is already deleted, so a failure here must not reject
		// (the card would claim "could not be deleted" and a retry would be
		// denied); it is logged and the leftovers stay orphaned.
		for (const name of [
			INVITES_COLLECTION,
			PENDING_INVITES_BY_EMAIL_COLLECTION,
		]) {
			try {
				await this.#deleteOwnedBy(name, id, ownerUid);
			} catch (error) {
				console.error(
					`Cleanup of ${name} after deleting event ${id} failed`,
					error,
				);
			}
		}
	}

	/** Lists by `invitedBy` + `eventId`, as the rules require, deletes in batches. */
	async #deleteOwnedBy(name: string, eventId: string, ownerUid: string) {
		const { docs } = await getDocs(
			query(
				collection(this.#firestore, name),
				where("invitedBy", "==", ownerUid),
				where("eventId", "==", eventId),
			),
		);
		for (let from = 0; from < docs.length; from += DELETE_BATCH_SIZE) {
			const batch = writeBatch(this.#firestore);
			for (const { ref } of docs.slice(from, from + DELETE_BATCH_SIZE)) {
				batch.delete(ref);
			}
			await batch.commit();
		}
	}

	async leave(id: string, uid: string): Promise<void> {
		// `arrayRemove`/`deleteField`, not a client-computed replacement of
		// `memberIds`/`roles`: the rule only cares about the resulting document
		// (see `leavesTheEvent()` in firestore.rules), and this way the write
		// never has to compute the same result minus one uid. The read gets the
		// owner the tombstone must name (ADR 0015).
		const ref = doc(this.#firestore, "events", id);
		const event = await getDoc(ref);
		const batch = writeBatch(this.#firestore);
		batch.update(ref, {
			memberIds: arrayRemove(uid),
			[`roles.${uid}`]: deleteField(),
		});
		batch.set(
			doc(this.#firestore, INVITES_COLLECTION, inviteId(id, uid)),
			inviteTombstone(
				id,
				uid,
				String(event.data()?.["userId"] ?? ""),
				serverTimestamp(),
			),
		);
		await batch.commit();
	}
}
