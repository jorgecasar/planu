import type { PlanuEvent } from "../lib/types.js";
import type { AnalyticsPort } from "./ports/analytics.js";
import type { EventRepositoryPort } from "./ports/event-repository.js";

export interface SaveEventRequest {
	/** Already validated by `eventSchema()`. */
	values: PlanuEvent;
	/** Who creates it; ignored when editing. */
	ownerUid: string;
	/** The event being edited, or `undefined` to create a new one. */
	editingId: string | undefined;
	/**
	 * Whether this is the account's first event (T31's `first_event_created`,
	 * GH-94). A function, not a value, so that *when* it is read is this use
	 * case's contract: before the write, because latency compensation updates
	 * the listing — and clears the flag — before `create()` resolves.
	 */
	isFirstEvent: () => boolean;
}

/**
 * Decision 5 of the spec: an all-day event is saved at local midnight, so it
 * doesn't drag along a leftover time and `toIcsDate()` can keep reading local
 * components. A no-op from the editor, whose `fromDateFields()` already uses
 * `"00:00"`; a guard for any caller that hands over an all-day event with a time.
 */
function normalize(values: PlanuEvent): PlanuEvent {
	if (!values.allDay) return values;
	const startOfDay = (found: Date) =>
		new Date(found.getFullYear(), found.getMonth(), found.getDate());
	return {
		...values,
		startDate: values.startDate ? startOfDay(values.startDate) : null,
		endDate: values.endDate ? startOfDay(values.endDate) : null,
	};
}

/**
 * Creates or updates an event. Resolves with the id of the event created,
 * or `undefined` after an update; rejects with whatever the repository threw.
 */
export async function saveEvent(
	repository: EventRepositoryPort,
	analytics: AnalyticsPort,
	request: SaveEventRequest,
): Promise<string | undefined> {
	const normalized = normalize(request.values);

	// Editing sends content only. Resending the editor's uid would cost an
	// invited editor their permission, because to the rules that is
	// transferring ownership; and membership is not touched from here, which
	// is what the share dialog is for. Never the first event, either.
	if (request.editingId !== undefined) {
		await repository.update(request.editingId, normalized);
		return undefined;
	}

	// An event is born with its creator as sole member and no guests: the
	// rules reject any other way of starting.
	const isFirst = request.isFirstEvent();
	const created = await repository.create(normalized, request.ownerUid);
	if (isFirst) {
		analytics.trackFirstEventCreated();
	}
	return created.id;
}
