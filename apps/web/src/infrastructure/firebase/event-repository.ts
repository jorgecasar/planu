import {
	addDoc,
	collection,
	doc,
	type Firestore,
	serverTimestamp,
	setDoc,
	Timestamp,
} from "firebase/firestore";
import type { EventRepositoryPort } from "../../application/ports/event-repository.js";
import type { PlanuEvent } from "../../lib/types.js";

/** De `PlanuEvent` a lo que Firestore acepta: las fechas pasan a `Timestamp`. */
function toContent(values: PlanuEvent) {
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
 * Único adaptador del repositorio de eventos que usa el editor: el resto del
 * componente conoce `EventRepositoryPort`, no `Firestore`.
 */
export class FirebaseEventRepository implements EventRepositoryPort {
	readonly #firestore: Firestore;

	constructor(firestore: Firestore) {
		this.#firestore = firestore;
	}

	async create(values: PlanuEvent, ownerUid: string): Promise<string> {
		// An event is born with its creator as sole member and no guests: the
		// rules reject any other way of starting.
		const created = await addDoc(collection(this.#firestore, "events"), {
			...toContent(values),
			userId: ownerUid,
			memberIds: [ownerUid],
			roles: {},
			createdAt: serverTimestamp(),
		});
		return created.id;
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
}
