import { msg } from "@lit/localize";
import type { PlanuEvent } from "../lib/types.js";

/** The three criteria the listing can be sorted by. */
export type SortField = "startDate" | "title" | "createdAt";

export type SortDirection = "asc" | "desc";

export interface SortPreference {
	field: SortField;
	direction: SortDirection;
}

/**
 * The soonest first: that's the question that brings the user to the
 * listing — "what do I have coming up" — not "what did I jot down
 * yesterday".
 *
 * `as const satisfies` and not `Object.freeze`: this way
 * `DEFAULT_SORT.field = "title"` fails to compile, which is where it matters
 * that it fails. Freezing at runtime would only defend against a caller in
 * plain JavaScript, and there isn't one here.
 */
export const DEFAULT_SORT = {
	field: "startDate",
	direction: "asc",
} as const satisfies SortPreference;

/**
 * The sort orders the selector offers, **and the only ones accepted when
 * reading the saved preference**.
 *
 * Having a single list is deliberate: the `value` strings for each option
 * used to be written by hand in the template and had to match what
 * `serializeSortPreference` produces. Nothing checked that, so changing the
 * separator left the selector with no option marked — the user stops seeing
 * which order is applied — while tests and the typecheck stayed green.
 *
 * And validating against this list, not just against the types, closes the
 * other hole: `title:desc` is a legitimate `SortPreference` the selector
 * doesn't know how to render, so arriving from `localStorage` it would leave
 * the label blank.
 */
const OFFERED = [
	{ preference: DEFAULT_SORT, label: () => msg("Date, soonest first") },
	{
		preference: { field: "startDate", direction: "desc" },
		label: () => msg("Date, latest first"),
	},
	{
		preference: { field: "title", direction: "asc" },
		label: () => msg("Title, A to Z"),
	},
	{
		preference: { field: "createdAt", direction: "desc" },
		label: () => msg("Recently added"),
	},
] as const satisfies readonly {
	preference: Readonly<SortPreference>;
	label: () => string;
}[];

export const OFFERED_SORTS: readonly Readonly<SortPreference>[] = OFFERED.map(
	(entry) => entry.preference,
);

/**
 * Persistence format: `field:direction`.
 *
 * JSON here would be ceremony — two keys, both from a closed vocabulary — and
 * it also invites reading it with `JSON.parse`, which throws inside
 * `render()` on a corrupt value. A plain string can't do that.
 *
 * **It's a persisted format**: changing it doesn't break anything visible,
 * but it silently discards the preference of everyone who already had one.
 * There's a test that pins down the literal strings so this is a decision,
 * not an oversight.
 */
export function serializeSortPreference(preference: SortPreference): string {
	return `${preference.field}:${preference.direction}`;
}

/**
 * Reads what was saved, without trusting it.
 *
 * Anything not in `OFFERED_SORTS` — garbage, `null`, an earlier version's
 * format, a combination the selector no longer offers — falls back to the
 * default value. The listing never ends up without an order because of
 * whatever is in storage.
 */
export function parseSortPreference(
	raw: string | null | undefined,
): SortPreference {
	const found = OFFERED_SORTS.find(
		(preference) => serializeSortPreference(preference) === raw,
	);
	return { ...(found ?? DEFAULT_SORT) };
}

/** An entry in the sort selector, already with its translated label. */
export interface SortOption {
	/** What travels in the control's `value` and in `localStorage`. */
	value: string;
	preference: Readonly<SortPreference>;
	label: string;
}

/**
 * A factory, not a constant: `msg()` is evaluated when it's called, so a
 * list built at module-import time would freeze the language of that
 * instant.
 *
 * The order is that of `OFFERED_SORTS`, and the `value`s come from
 * `serializeSortPreference`, not from literals written separately.
 */
export function sortOptions(): SortOption[] {
	return OFFERED.map(({ preference, label }) => ({
		value: serializeSortPreference(preference),
		preference,
		label: label(),
	}));
}

/** The three piles the listing is split into. */
export type EventGroupName = "upcoming" | "undated" | "past";

export interface EventGroups<T> {
	upcoming: T[];
	undated: T[];
	past: T[];
}

/**
 * Undated means having **neither** of the two, exactly as `filterEvents`
 * understands it: there, such an event always passes the range filter
 * because there's nothing to compare it against. Here, for the same reason,
 * it can't be placed among the dated ones, so it goes to its own group.
 */
function isUndated(event: PlanuEvent): boolean {
	return !event.startDate && !event.endDate;
}

/**
 * The end that sorting goes by.
 *
 * An event may carry only one of the two, and `filterEvents` already solves
 * that case by making the end that's present stand in for both (`rangeEnd =
 * to ?? from`). The same criterion is repeated here instead of inventing
 * another one.
 */
const startOf = (event: PlanuEvent): Date | null =>
	event.startDate ?? event.endDate ?? null;

/**
 * When an event stops being ongoing. `null` means "not yet".
 *
 * Here the `startOf` shortcut — the end that's present stands in for both —
 * does **not** apply, and that cost a review: with `endDate ?? startDate`,
 * roadworks that started on June 10th and have no declared end moved to
 * "past" on the 11th, while still ongoing. The monthly grid kept painting
 * them on today's date, because `eventSpan` decides differently, so **the
 * same event showed up ongoing on the calendar and archived on the agenda
 * and on the cards**. It's only visible when the three views are put side by
 * side, which is exactly what the task that closes the phase exists for.
 *
 * The calendar's semantics rule, and those are the ones the user chose in
 * T20:
 *
 * - **With no end, it's still ongoing**: it isn't a point in time, it's
 *   something that started and hasn't finished. It's never past.
 * - **With no start**, the end is a deadline and it's the one that closes it.
 * - **With the end before the start** — inconsistent data the schema rejects
 *   but that could have been saved before it existed — it collapses to the
 *   start, the same as `eventSpan` does. Otherwise the event fell into the
 *   past fold under a future day's heading.
 *
 * What does **not** change is the order: `sortKey` still looks at `startOf`,
 * so an event is placed in the list by where it starts, not by where it
 * ends.
 */
function activeUntil(event: PlanuEvent): Date | null {
	const start = event.startDate ?? null;
	const end = event.endDate ?? null;

	if (start && end) return end.getTime() >= start.getTime() ? end : start;
	if (start) return null;
	return end;
}

/**
 * The key each criterion sorts by.
 *
 * `null` means "unknown", and that's resolved separately: the unknown goes
 * to the end **no matter which order is requested**. Reversing the direction
 * and finding events with nothing on record at the top is exactly the
 * opposite of what was asked for when sorting.
 */
function sortKey(event: PlanuEvent, field: SortField): number | string | null {
	switch (field) {
		case "title":
			return event.title;
		case "createdAt":
			return event.createdAt?.getTime() ?? null;
		case "startDate":
			return startOf(event)?.getTime() ?? null;
	}
}

/**
 * Sorts without touching the received array.
 *
 * Generic so nothing the caller attached to the event is lost on the way,
 * such as the `id` it carries from Firestore.
 *
 * The tiebreaker is **always by title and always ascending**, even when a
 * descending order is requested. Two events on the same day are a common
 * case — a single day with several sessions — and the list reads better if
 * that block keeps the alphabetical order instead of being reversed along
 * with the primary criterion, which no longer distinguishes anything there.
 * If the titles also match, `Array#sort` is stable and preserves the input
 * order.
 *
 * The `locale` is optional and exists for testing, just like in
 * `formatEventDates`: alphabetical order depends on the language — in
 * Swedish "å" sorts after "z", not near "a" — and in production it's left
 * to the browser's, which is what the user expects.
 */
export function sortEvents<T extends PlanuEvent>(
	events: readonly T[],
	preference: SortPreference = DEFAULT_SORT,
	locale?: string,
): T[] {
	const collator = new Intl.Collator(locale);
	const sign = preference.direction === "desc" ? -1 : 1;

	return [...events].sort((a, b) => {
		const left = sortKey(a, preference.field);
		const right = sortKey(b, preference.field);

		if (left === null || right === null) {
			if (right !== null) return 1;
			if (left !== null) return -1;
		} else {
			const primary =
				typeof left === "number" && typeof right === "number"
					? left - right
					: collator.compare(String(left), String(right));
			if (primary !== 0) return primary * sign;
		}

		return collator.compare(a.title, b.title);
	});
}

/**
 * Which pile an event belongs to relative to a given instant.
 *
 * Past means having **finished** before `now`, not having started: a
 * three-day conference is still upcoming on the second day, and one with no
 * declared end never becomes past (see `activeUntil`). The boundary is
 * inclusive, just like in `filterEvents`, so something that ends exactly at
 * `now` still counts as upcoming.
 *
 * This is the project's **only** definition of "past": it's used by the
 * card grid, the agenda, and — through `eventSpan`, which says the same
 * thing in a different shape — the monthly grid.
 */
export function groupOf(event: PlanuEvent, now: Date): EventGroupName {
	if (isUndated(event)) return "undated";

	const end = activeUntil(event);
	return end !== null && end.getTime() < now.getTime() ? "past" : "upcoming";
}

export interface GroupOptions {
	/**
	 * The instant that separates upcoming from past. It's injected on
	 * purpose: with `Date.now()` inside, this function couldn't be tested
	 * without depending on the clock of whoever runs the tests.
	 */
	now: Date;
	sort?: SortPreference;
	locale?: string | undefined;
}

/**
 * Sorts first and splits afterward, so the chosen criterion applies equally
 * within all three groups. The past group isn't reversed: the order is the
 * one the user asked for, not a different one per group.
 */
export function groupEvents<T extends PlanuEvent>(
	events: readonly T[],
	options: GroupOptions,
): EventGroups<T> {
	const { now, sort = DEFAULT_SORT, locale } = options;
	const groups: EventGroups<T> = { upcoming: [], undated: [], past: [] };

	for (const event of sortEvents(events, sort, locale)) {
		groups[groupOf(event, now)].push(event);
	}

	return groups;
}

/** What's needed to decide whether the past fold opens. */
export interface PastDisclosure {
	upcoming: number;
	undated: number;
	past: number;
	/**
	 * The user has narrowed the listing on purpose: there's a search term or
	 * a date range. The chosen tray — all, mine, shared — doesn't count: it's
	 * a navigation mode, not a specific question, and when it leaves only
	 * past events, the first rule already covers it.
	 */
	narrowed: boolean;
}

/**
 * Whether the past group should come out open.
 *
 * Folded by default is still the right call — the past is something you
 * look up, not an agenda — but always folding it hides results the user
 * just asked for. With three already-finished events titled "April fair"
 * and a search for "fair", `filterEvents` returns three, so the "no event
 * matches" message is never reached and the screen ends up with a closed
 * accordion strip and **zero cards**. Same thing with the range set to a
 * month already past, where *all* the results fall inside the fold.
 *
 * Hence the two cases that open it:
 *
 * 1. **It's the only group with anything.** The alternative is an empty
 *    page that explains nothing.
 * 2. **The user has searched or filtered by dates.** Answering an explicit
 *    question with a closed drawer is not answering it.
 */
export function shouldRevealPast(counts: PastDisclosure): boolean {
	if (counts.past === 0) return false;
	if (counts.upcoming === 0 && counts.undated === 0) return true;
	return counts.narrowed;
}
