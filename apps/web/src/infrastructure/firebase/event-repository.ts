import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	type Firestore,
	getCountFromServer,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	Timestamp,
	updateDoc,
	where,
} from "firebase/firestore";
import type {
	CreatedEvent,
	EventRepositoryPort,
	StoredEvent,
} from "../../application/ports/event-repository.js";
import type { EventRole, PlanuEvent } from "../../lib/types.js";

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
 * Converts a Firestore document into a StoredEvent, validating it.
 * The rules already enforce types, but the client shouldn't trust that a
 * document complies: the ones inherited from the prototype never went
 * through them. Without validation, a numeric `description` would blow
 * up `.toLowerCase()` inside `render()`, and Lit doesn't catch that: it
 * broke the whole listing, not a single card.
 *
 * Returns `null` for whatever doesn't fit, which gets discarded.
 */
export function toStoredEvent(document: {
	id: string;
	data: () => Record<string, unknown>;
}): StoredEvent | null {
	const raw = document.data();
	const asDate = (value: unknown): Date | null =>
		value instanceof Timestamp ? value.toDate() : null;

	const parsed = PlanuEventSchema.safeParse({
		title: raw["title"],
		description: raw["description"],
		location: raw["location"],
		imageUrl: raw["imageUrl"],
		userId: raw["userId"],
		memberIds: raw["memberIds"],
		roles: raw["roles"],
		startDate: asDate(raw["startDate"]),
		endDate: asDate(raw["endDate"]),
		createdAt: asDate(raw["createdAt"]),
		tags: raw["tags"],
		allDay: raw["allDay"],
	});

	if (!parsed.success) {
		console.warn("Evento descartado por no validar:", document.id);
		return null;
	}

	return { ...parsed.data, id: document.id };
}

/**
 * Zod schema for validating stored events. Defined here (infrastructure)
 * because it knows about `Timestamp` from Firestore.
 */
import { z } from "zod";
import { normalizeTags } from "../../domain/tags.js";

const PlanuEventSchema = z
	.object({
		id: z.string().optional(),
		title: z.string().min(3),
		description: z.string().optional(),
		location: z.string().optional(),
		startDate: z.coerce.date().nullable().optional(),
		endDate: z.coerce.date().nullable().optional(),
		imageUrl: z.string().url().optional().or(z.literal("")),
		userId: z.string().optional(),
		memberIds: z.array(z.string()).default([]),
		roles: z.record(z.string(), z.enum(["viewer", "editor"])).default({}),
		createdAt: z.coerce.date().nullable().optional(),
		allDay: z.boolean().default(true),
		tags: z
			.unknown()
			.optional()
			.transform((value) =>
				normalizeTags(
					Array.isArray(value)
						? value.filter((item): item is string => typeof item === "string")
						: [],
				),
			),
	})
	.refine(
		(data) => {
			if (data.startDate && data.endDate) {
				return data.startDate <= data.endDate;
			}
			return true;
		},
		{
			message: "End date cannot be earlier than start date.",
			path: ["endDate"],
		},
	);

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

	async delete(id: string): Promise<void> {
		await deleteDoc(doc(this.#firestore, "events", id));
	}

	async updateMembership(
		id: string,
		memberIds: string[],
		roles: Record<string, EventRole>,
	): Promise<void> {
		await updateDoc(doc(this.#firestore, "events", id), {
			memberIds,
			roles,
		});
	}

	async *listFor(uid: string): AsyncIterable<StoredEvent> {
		const q = query(
			collection(this.#firestore, "events"),
			where("memberIds", "array-contains", uid),
		);

		const snapshot = await getDocs(q);
		for (const docSnap of snapshot.docs) {
			const event = toStoredEvent({
				id: docSnap.id,
				data: () => docSnap.data(),
			});
			if (event) yield event;
		}
	}
}
