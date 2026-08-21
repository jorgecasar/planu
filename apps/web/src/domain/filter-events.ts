import type { PlanuEvent } from "../lib/types.js";

export interface DateRange {
	from?: Date | null | undefined;
	to?: Date | null | undefined;
}

/** Matches if the term appears in the title or in the description. */
function matchesSearch(event: PlanuEvent, term: string): boolean {
	if (term === "") return true;
	if (event.title.toLowerCase().includes(term)) return true;
	return event.description?.toLowerCase().includes(term) ?? false;
}

/**
 * Overlap between the event and the range, with inclusive criteria.
 *
 * Two rules inherited from the prototype that aren't obvious:
 * - An event **without dates** always passes the filter. The alternative —
 *   hiding it — would make events the user does want to see disappear.
 * - With only one end of the range, that end stands in for both, so
 *   filtering by a single day looks for events active on that day, not ones
 *   that start on it.
 */
function matchesRange(event: PlanuEvent, range: DateRange): boolean {
	const { from, to } = range;
	if (!from && !to) return true;

	const start = event.startDate ?? null;
	const end = event.endDate ?? null;
	if (!start && !end) return true;

	const rangeStart = from ?? to;
	const rangeEnd = to ?? from;
	if (!rangeStart || !rangeEnd) return true;

	if (start && !end) return start <= rangeEnd;
	if (!start && end) return end >= rangeStart;
	if (start && end) return start <= rangeEnd && end >= rangeStart;

	return false;
}

/**
 * Whose events to show.
 *
 * Now that an event can have guests, the listing mixes your own with what
 * other people shared, and the two need separating.
 */
export type OwnershipFilter = "all" | "mine" | "shared";

/**
 * Ownership is decided by `userId` alone. Roles need not be consulted: in
 * someone else's event you are a guest by definition, and with an empty uid —
 * a session not yet resolved — nothing counts as yours, which is the safe way
 * round.
 */
function matchesOwnership(
	event: PlanuEvent,
	uid: string,
	ownership: OwnershipFilter,
): boolean {
	if (ownership === "all") return true;

	const isOwner = uid !== "" && event.userId === uid;
	return ownership === "mine" ? isOwner : !isOwner;
}

/**
 * All the selected tags must be on the event: they're combined with **AND**,
 * not **OR** (F6).
 *
 * With **OR**, adding a tag to the filter widens the result, which makes the
 * filter useless as soon as the user has a handful. With **AND**, each tag
 * added narrows it down, which is what's expected of a filter.
 *
 * The selected ones are assumed to be normalized: they come from the ones the
 * user already uses, not from typed text.
 */
function matchesTags(event: PlanuEvent, selected: readonly string[]): boolean {
	if (selected.length === 0) return true;
	return selected.every((tag) => event.tags.includes(tag));
}

export interface EventFilters extends DateRange {
	searchTerm?: string;
	ownership?: OwnershipFilter;
	/** Who is looking. Without it, "mine" means nothing. */
	uid?: string;
	/** Combined with AND: an event must carry all of them. */
	tags?: readonly string[];
}

/**
 * Filters by text, by date range, by ownership and by tag. The criteria add
 * up: all four must hold.
 *
 * Generic so nothing the caller attached to the event is lost on the way, such
 * as the `id` it carries from Firestore.
 */
export function filterEvents<T extends PlanuEvent>(
	events: readonly T[],
	searchTerm = "",
	range: DateRange = {},
	ownership: OwnershipFilter = "all",
	uid = "",
	tags: readonly string[] = [],
): T[] {
	const term = searchTerm.trim().toLowerCase();
	return events.filter(
		(event) =>
			matchesSearch(event, term) &&
			matchesRange(event, range) &&
			matchesOwnership(event, uid, ownership) &&
			matchesTags(event, tags),
	);
}

/**
 * Whether the user has asked for something specific, as opposed to just
 * browsing.
 *
 * It used to live duplicated in the view, and the two copies **disagreed**:
 * one counted tags and the other didn't, so filtering by the tag "music" and
 * searching for "music" — same intent, same results — behaved differently.
 * It lives here because it's a rule, not markup, and here it can be tested.
 *
 * The chosen tray (all / mine / shared) is left out on purpose: it's a way of
 * navigating, not a query.
 */
export function isNarrowed(filters: EventFilters): boolean {
	return (
		(filters.searchTerm ?? "") !== "" ||
		Boolean(filters.from) ||
		Boolean(filters.to) ||
		(filters.tags?.length ?? 0) > 0
	);
}
