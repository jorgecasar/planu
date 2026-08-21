import {
	type GroupOptions,
	groupOf,
	sortEvents,
} from "../domain/sort-events.js";
import type { PlanuEvent } from "../lib/types.js";
import { dayKey, safeLocale } from "./month-grid.js";

/** A day in the agenda: the date, how it's written, and what's on it that day. */
export interface AgendaDay<T> {
	/** The day as a comparable integer. See `dayKey`. */
	key: number;
	/**
	 * The day it represents, **at 12:00 local time**, for the same reason as in
	 * `MonthCell`: there are timezones where midnight doesn't exist one day a
	 * year and the engine returns 01:00 instead. Noon always exists.
	 */
	date: Date;
	/** Full date according to the locale, to head the day. */
	label: string;
	events: T[];
}

/**
 * The agenda: days with content, plus the events that have no date.
 *
 * The three piles are the ones from `groupEvents`, and that's deliberate: no
 * new semantics for "past" or "undated" are invented for this view.
 */
export interface Agenda<T> {
	upcoming: AgendaDay<T>[];
	undated: T[];
	past: AgendaDay<T>[];
}

/** How many events are spread across a list of days. */
export function countEvents<T>(days: readonly AgendaDay<T>[]): number {
	return days.reduce((total, day) => total + day.events.length, 0);
}

/**
 * The day by which an event enters the agenda.
 *
 * It's **the same end that `sortEvents` uses to order it** (`startDate ??
 * endDate`), and not by coincidence: if the agenda grouped by a day different
 * from the one that decides the position, the list would stop being monotonic
 * in its own key and the same day would appear twice, separated by another.
 *
 * It's also a **different** semantics from `eventSpan`'s, which spreads the
 * event across every day it occupies. That makes sense there —a month cell
 * shows one line per event, so the span is visible—; here a three-day
 * conference would repeat its whole card three times in a list you scroll
 * through top to bottom. In the agenda each event shows up **once**, on the
 * day it starts.
 */
function anchorOf(event: PlanuEvent): Date | null {
	return event.startDate ?? event.endDate ?? null;
}

/** The local noon of the day a date belongs to. */
function noonOf(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

export type AgendaOptions = GroupOptions;

/**
 * Spreads the events across days.
 *
 * It sorts first with the user's preference and spreads afterward, just like
 * `groupEvents`: this way **the chosen order also governs the sequence of
 * days**. With "date, soonest first" —the default value— the days come out
 * in ascending chronological order, which is the agenda F5 asks for; with
 * "date, farthest first" they come out reversed, which is what the user just
 * asked for. The day is placed where its first event appears, so the
 * sequence of days always follows the order itself and not a second
 * ordering that could contradict it.
 */
export function buildAgenda<T extends PlanuEvent>(
	events: readonly T[],
	options: AgendaOptions,
): Agenda<T> {
	const { now, sort } = options;

	// It's sanitized **once, for both uses**. `Intl.Collator` throws
	// `RangeError` with an invalid tag exactly the same way as
	// `Intl.DateTimeFormat`, so protecting only the formatter left the whole
	// agenda blowing up inside `sortEvents` with the same input that here was
	// already taken as handled.
	const locale = safeLocale(options.locale);

	const format = new Intl.DateTimeFormat(locale, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});

	const upcoming = new Map<number, AgendaDay<T>>();
	const past = new Map<number, AgendaDay<T>>();
	const undated: T[] = [];

	for (const event of sortEvents(events, sort, locale)) {
		const anchor = anchorOf(event);

		// Without either end, which is exactly what `groupEvents` understands as
		// "undated". There's no day to put it on without inventing one.
		if (anchor === null) {
			undated.push(event);
			continue;
		}

		// Upcoming or past is decided by the domain, not by this function: past
		// means having **ended**, and a three-day conference is still upcoming
		// on its second day even if its entry day is already behind.
		const days = groupOf(event, now) === "past" ? past : upcoming;
		const key = dayKey(anchor);
		const day = days.get(key);

		if (day) {
			day.events.push(event);
		} else {
			const date = noonOf(anchor);
			days.set(key, { key, date, label: format.format(date), events: [event] });
		}
	}

	return {
		upcoming: [...upcoming.values()],
		undated,
		past: [...past.values()],
	};
}
