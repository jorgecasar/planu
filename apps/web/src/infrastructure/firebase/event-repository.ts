import {
	addDoc,
	arrayRemove,
	collection,
	deleteDoc,
	deleteField,
	doc,
	type Firestore,
	serverTimestamp,
	setDoc,
	Timestamp,
	updateDoc,
} from "firebase/firestore";
import type {
	CreatedEvent,
	EventRepositoryPort,
} from "../../application/ports/event-repository.js";
import type { PlanuEvent } from "../../lib/types.js";

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

	async delete(id: string): Promise<void> {
		await deleteDoc(doc(this.#firestore, "events", id));
	}

	async leave(id: string, uid: string): Promise<void> {
		// `arrayRemove`/`deleteField`, not a client-computed replacement of
		// `memberIds`/`roles`: the rule only cares about the resulting document
		// (see `leavesTheEvent()` in firestore.rules), and this way the write
		// never has to read the event back first just to compute the same
		// result minus one uid.
		await updateDoc(doc(this.#firestore, "events", id), {
			memberIds: arrayRemove(uid),
			[`roles.${uid}`]: deleteField(),
		});
	}
}
