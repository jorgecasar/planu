import {
	addDoc,
	collection,
	doc,
	type Firestore,
	getCountFromServer,
	query,
	serverTimestamp,
	setDoc,
	Timestamp,
	where,
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
 * The only event-repository adapter the editor uses: the rest of the
 * component knows `EventRepositoryPort`, not `Firestore`.
 */
export class FirebaseEventRepository implements EventRepositoryPort {
	readonly #firestore: Firestore;

	constructor(firestore: Firestore) {
		this.#firestore = firestore;
	}

	async create(values: PlanuEvent, ownerUid: string): Promise<CreatedEvent> {
		// The count runs *before* the write, not after: `first_event_created`
		// (T31) needs to know whether this account had zero events, and asking
		// afterward would always see at least one — the one just created. A
		// count, not a listing: it stays a lightweight aggregation query
		// regardless of how many events the account already has.
		//
		// `memberIds array-contains`, not `userId ==`: the rules deny every
		// other shape for this collection (see the same filter in
		// events-view.ts), so this counts events the account can see — its own
		// plus anything shared with it — not strictly ones it created. Close
		// enough for an activation metric, and the only shape the rules allow.
		const before = await getCountFromServer(
			query(
				collection(this.#firestore, "events"),
				where("memberIds", "array-contains", ownerUid),
			),
		);

		// An event is born with its creator as sole member and no guests: the
		// rules reject any other way of starting.
		const created = await addDoc(collection(this.#firestore, "events"), {
			...toContent(values),
			userId: ownerUid,
			memberIds: [ownerUid],
			roles: {},
			createdAt: serverTimestamp(),
		});
		return { id: created.id, wasFirstEvent: before.data().count === 0 };
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
