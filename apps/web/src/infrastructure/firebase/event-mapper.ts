import { type DocumentData, Timestamp } from "firebase/firestore";
import {
	eventSchema,
	type PlanuEvent,
	type StoredEvent,
} from "../../lib/types.js";

/**
 * An event as it lives in Firestore: dates are `Timestamp`, not `Date`.
 * `domain/` never sees this shape — `eventSchema()` already works in `Date`
 * via `z.coerce.date()`, which is what lets `toStoredEvent()` below hand it
 * a plain object and stay the only place that knows `Timestamp` exists.
 */
export type PlanuEventDocument = Omit<
	PlanuEvent,
	"id" | "startDate" | "endDate" | "createdAt"
> & {
	startDate: Timestamp | null;
	endDate: Timestamp | null;
	createdAt?: Timestamp | null;
	imageUrl?: string | null;
	allDay: boolean;
};

/**
 * Converts a Firestore document into an event, validating it.
 *
 * The rules already enforce types, but the client shouldn't trust that a
 * document complies: the ones inherited from the prototype never went
 * through them. Without validation, a numeric `description` would blow up
 * `.toLowerCase()` inside a card's `render()`, and Lit doesn't catch that: it
 * broke the whole listing, not a single card.
 *
 * Returns `null` for whatever doesn't fit, which gets discarded by the
 * caller.
 */
export function toStoredEvent(
	document: DocumentData & { id: string },
): StoredEvent | null {
	const asDate = (value: unknown) =>
		value instanceof Timestamp ? value.toDate() : null;

	const parsed = eventSchema().safeParse({
		title: document["title"],
		description: document["description"],
		location: document["location"],
		imageUrl: document["imageUrl"],
		userId: document["userId"],
		memberIds: document["memberIds"],
		roles: document["roles"],
		startDate: asDate(document["startDate"]),
		endDate: asDate(document["endDate"]),
		createdAt: asDate(document["createdAt"]),
		tags: document["tags"],
		// Without listing the key, an event saved with an hour always read back
		// as all-day: `allDay` was missing from the object reaching
		// `safeParse`, and `z.boolean().default(true)` filled the gap. The
		// implicit migration — documents predating this feature, with no
		// field — keeps working the same way: `document["allDay"]` is
		// `undefined` for them, and the same `default(true)` decides all-day.
		allDay: document["allDay"],
	});

	if (!parsed.success) {
		console.warn("Evento descartado por no validar:", document["id"]);
		return null;
	}

	return { ...parsed.data, id: document["id"] };
}
