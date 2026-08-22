import { type SortPreference, sortEvents } from "../domain/sort-events.js";
import type { PlanuEvent } from "../lib/types.js";

/**
 * Day of the week using `Date.prototype.getDay()`'s numbering:
 * 0 = Sunday … 6 = Saturday.
 *
 * It's not the one from `Intl.Locale.prototype.getWeekInfo()`, which follows
 * ISO 8601 (1 = Monday … 7 = Sunday). The conversion happens in a single
 * place, below.
 */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const SUNDAY: WeekDay = 0;
const MONDAY: WeekDay = 1;
const FRIDAY: WeekDay = 5;
const SATURDAY: WeekDay = 6;

/**
 * The regions whose week does **not** start on Monday, which is the majority
 * case and serves as the default.
 *
 * The three tables aren't written by hand: they come from walking all 676
 * two-letter region codes and asking ICU itself via `getWeekInfo()`. A
 * hand-written table mistook Saturday for Monday in fourteen Arabic regions
 * and couldn't even represent the Maldives' Friday.
 *
 * A test walks the 676 again and compares the two paths, so the fallback is
 * **tied to the ICU version of the browser we test with**. If that test
 * fails naming a region, it's a fact that has shifted and what's needed is
 * regenerating the table, not fixing the logic. There's already precedent:
 * Node 24 and Chromium's ICU disagree today on Iceland.
 */
const FRIDAY_REGIONS = new Set(["MV"]);

const SATURDAY_REGIONS = new Set([
	"AF",
	"BH",
	"DJ",
	"DZ",
	"EG",
	"IQ",
	"IR",
	"JO",
	"KW",
	"LY",
	"OM",
	"QA",
	"SD",
	"SY",
]);

const SUNDAY_REGIONS = new Set([
	"AG",
	"AS",
	"BD",
	"BR",
	"BS",
	"BT",
	"BU",
	"BW",
	"BZ",
	"CA",
	"CO",
	"DM",
	"DO",
	"ET",
	"GT",
	"GU",
	"HK",
	"HN",
	"ID",
	"IL",
	"IN",
	"IS",
	"JM",
	"JP",
	"JT",
	"KE",
	"KH",
	"KR",
	"LA",
	"MH",
	"MI",
	"MM",
	"MO",
	"MT",
	"MX",
	"MZ",
	"NI",
	"NP",
	"NT",
	"PA",
	"PE",
	"PH",
	"PK",
	"PR",
	"PT",
	"PU",
	"PY",
	"PZ",
	"RH",
	"SA",
	"SG",
	"SV",
	"TH",
	"TT",
	"TW",
	"UM",
	"US",
	"VE",
	"VI",
	"WK",
	"WS",
	"YD",
	"YE",
	"ZA",
	"ZW",
]);

/**
 * First day of the week according to the locale, without `getWeekInfo()`.
 *
 * The region comes from `maximize()`, not from splitting the tag on hyphens:
 * in `de-u-ca-gregory` the first two-letter chunk is `ca`, and taking it for
 * Canada left German starting the week on Sunday.
 *
 * It's exported so it can be tested: in Chromium `getWeekInfo()` always
 * exists and this path would go unexercised, which is how a broken fallback
 * slips through.
 */
export function fallbackFirstDayOfWeek(locale: string | undefined): WeekDay {
	if (!locale) return MONDAY;

	let region: string | undefined;
	try {
		const tag = new Intl.Locale(locale);
		// The explicit region overrides the one `maximize()` infers, which for
		// an unknown one —`und-ZZ`— makes up `US` and returned Sunday.
		region = tag.region ?? tag.maximize().region;
	} catch {
		return MONDAY;
	}

	if (!region) return MONDAY;
	if (FRIDAY_REGIONS.has(region)) return FRIDAY;
	if (SATURDAY_REGIONS.has(region)) return SATURDAY;
	if (SUNDAY_REGIONS.has(region)) return SUNDAY;

	return MONDAY;
}

/**
 * `getWeekInfo()` isn't in TypeScript's libraries yet, and declaring it
 * optional is also the correct thing to do: not every browser ships it.
 */
type LocaleWithWeekInfo = Intl.Locale & {
	getWeekInfo?: () => { firstDay: number };
};

/**
 * First day of the week for the active locale.
 *
 * `Intl.Locale.prototype.getWeekInfo()` isn't Baseline widely available, so
 * it goes behind availability detection and degrades to the table above,
 * just as the project's browser support policy requires.
 */
export function firstDayOfWeek(locale?: string): WeekDay {
	// Without a locale, the environment's; not `navigator`, since there's no
	// document here.
	const tag = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;

	try {
		const info = (new Intl.Locale(tag) as LocaleWithWeekInfo).getWeekInfo?.();
		// The ISO numbers 1 = Monday … 7 = Sunday; `getDay()`, 0 = Sunday.
		if (info) return (info.firstDay % 7) as WeekDay;
	} catch {
		// Invalid locale tag: better the fallback than crashing the view.
	}

	return fallbackFirstDayOfWeek(tag);
}

/**
 * A locale tag that `Intl` accepts, or `undefined` to use the environment's.
 *
 * `Intl.DateTimeFormat` throws `RangeError` with a malformed tag, and
 * `buildMonthGrid` constructs four of them. Without this filter, any
 * `locale` arriving from outside left the view blank: `firstDayOfWeek()` did
 * protect itself, but it was the only protected spot along the whole path.
 */
export function safeLocale(locale?: string): string | undefined {
	if (locale === undefined) return undefined;

	try {
		return new Intl.DateTimeFormat(locale).resolvedOptions().locale;
	} catch {
		return undefined;
	}
}

/**
 * Identifies a local calendar day with a comparable integer: 20260629.
 *
 * It's what lets you decide whether an event falls in a cell **without
 * subtracting dates**. Comparing timestamps would force you to reason about
 * timezones and time changes; comparing local fields is exactly the question
 * a calendar asks.
 */
export function dayKey(date: Date): number {
	return (
		date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
	);
}

/**
 * Days an event occupies, as an inclusive pair of keys.
 *
 * Four rules, and none of them is obvious:
 * - With no date at all it occupies no day: `null`. A cell **is** a date, and
 *   placing it in one would force us to invent it. Those events go out
 *   separately in `undated`, and the view offers them in a list alongside
 *   instead of just counting them: an event that exists but can't be reached
 *   is lost.
 * - **With no end, it lasts from its start onward.** It's not a point in
 *   time: it's something that started and hasn't finished. It's painted
 *   through the end of the visible grid, and painted again in the following
 *   months, because it's still ongoing.
 * - **With no start, it lasts from today until its end.** An end with no
 *   start is a deadline, and what's useful is seeing how much is left; if
 *   the end has already passed, only that day is painted so as not to fill
 *   the past with something no longer ongoing.
 * - With the end before the start —inconsistent data the schema rejects but
 *   that could have been saved before— it collapses to the start day rather
 *   than painting nothing.
 *
 * It's a **different** semantics from `domain/filter-events.ts`'s, where a
 * single end stands in for both, and it's deliberately decided this way:
 * there the question is "does this event overlap the range I asked for?",
 * and here "on which days is it ongoing?". The same answer doesn't serve
 * both questions.
 */
function eventSpan(
	event: PlanuEvent,
	windowEnd: number,
	today: number,
): [number, number] | null {
	const start = event.startDate ?? null;
	const end = event.endDate ?? null;

	if (start && end) {
		const from = dayKey(start);
		const to = dayKey(end);
		return to >= from ? [from, to] : [from, from];
	}

	// No end: open-ended forward, bounded by what's being painted.
	if (start) {
		const from = dayKey(start);
		return [from, Math.max(from, windowEnd)];
	}

	// No start: from today until the end. If the end has already passed, just
	// that day.
	if (end) {
		const to = dayKey(end);
		return to >= today ? [today, to] : [to, to];
	}

	return null;
}

/** A grid cell: a calendar day and what happens on it. */
export interface MonthCell<T> {
	/**
	 * The day it represents, **at 12:00 local time**.
	 *
	 * And not at midnight, even though that seems natural, for two reasons
	 * that add up. There are timezones where 00:00 doesn't exist one day a
	 * year —Santiago, Havana, Asuncion, Beirut— and the engine returns 01:00
	 * instead; worse still, `setDate()` keeps the cursor's time, so that
	 * offset **doesn't fix itself**: in Santiago in 2024 the whole grid from
	 * September 8th onward stayed stuck at 01:00. Noon exists in every
	 * timezone and on every day, because no real time-change jump reaches it.
	 *
	 * It matters because `date` is a public field and its consumers —T22's
	 * `.ics`, the first one— will read it expecting a day, not an instant.
	 */
	date: Date;
	/** The day as a comparable integer. See `dayKey`. */
	key: number;
	/** `false` on the filler days from the previous or the following month. */
	inMonth: boolean;
	isToday: boolean;
	/** Full date according to the locale, to label the cell. */
	label: string;
	/** The day's number, formatted according to the locale. */
	day: string;
	/** Events active that day, in the order they arrived. */
	events: T[];
}

/** Column header: the day's name, short and long. */
export interface WeekdayHeading {
	short: string;
	long: string;
}

export interface MonthGrid<T> {
	/** First day of the represented month. */
	month: Date;
	/** Month and year according to the locale: "June 2026". */
	title: string;
	/** The seven days, starting from the locale's first day of the week. */
	weekdays: WeekdayHeading[];
	/** Complete weeks: between four and six, never partial. */
	weeks: MonthCell<T>[][];
	/** Events with no date at all. They don't fit in the calendar; see `eventSpan`. */
	undated: T[];
}

/**
 * Spreads the events across the month's cells.
 *
 * A pure function: everything that can vary —the month, the locale, and what
 * day today is— comes in as a parameter. Without that there would be no way
 * to test the daylight saving time change without waiting for March.
 *
 * The grid always brings complete weeks, so it drags in days from the
 * previous and following months. They're real days and carry their events:
 * an event that starts June 30 and ends July 2 shows up in full in both
 * views.
 *
 * **The day advance is done with `setDate()`, never by adding 86,400,000
 * ms.** A day doesn't always last 24 hours: October 25, 2026 in Madrid lasts
 * 25 hours, and adding milliseconds leaves the cursor at 23:00 on that same
 * day. From there the grid repeats it and loses the month's last day.
 * `setDate()` operates on local fields and survives the time change.
 *
 * Generic so nothing the caller has hung off the event gets lost along the
 * way, like the `id` it brings from Firestore.
 *
 * **Sorts with `sortEvents` before distributing** (T49 of the hours spec):
 * with a bare date it barely showed, but with an hour, two events on the
 * same day came out in whatever order Firestore happened to return, which
 * is an unordered list of times. It's a property of the grid, same as
 * `groupEvents` and `buildAgenda` already do; the caller doesn't have to
 * sort beforehand.
 */
export function buildMonthGrid<T extends PlanuEvent>(
	events: readonly T[],
	month: Date,
	locale?: string,
	today: Date = new Date(),
	sort?: SortPreference,
): MonthGrid<T> {
	const year = month.getFullYear();
	const monthIndex = month.getMonth();

	// Once, for the whole path: if the tag isn't valid, the environment's is
	// used in all four formatters, in the first day of the week, **and** in
	// `sortEvents`'s ordering — a malformed locale shouldn't make sorting
	// blow up where the rest of the function already guards against it.
	const tag = safeLocale(locale);
	const sorted = sortEvents(events, sort, tag);

	// At noon for the same reason as the cells: it's a public date.
	const first = new Date(year, monthIndex, 1, 12);
	// Day 0 of the next month is this one's last day: 28, 29, 30, or 31.
	const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

	const firstDay = firstDayOfWeek(tag);
	const lead = (first.getDay() - firstDay + 7) % 7;
	const weekCount = Math.ceil((lead + daysInMonth) / 7);

	const labelFormat = new Intl.DateTimeFormat(tag, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
	const dayFormat = new Intl.DateTimeFormat(tag, { day: "numeric" });
	const shortFormat = new Intl.DateTimeFormat(tag, { weekday: "short" });
	const longFormat = new Intl.DateTimeFormat(tag, { weekday: "long" });

	const todayKey = dayKey(today);

	// The last day this grid ever paints, including the following month's
	// filler. It's what bounds an event with no end date: it's still open,
	// but here it can only be painted as far as there are cells.
	const windowEndDate = new Date(year, monthIndex, 1);
	windowEndDate.setDate(windowEndDate.getDate() - lead + weekCount * 7 - 1);
	const windowEnd = dayKey(windowEndDate);

	const spans = sorted.map(
		(event) => [event, eventSpan(event, windowEnd, todayKey)] as const,
	);

	// A single cursor that advances day by day through calendar fields.
	const cursor = new Date(year, monthIndex, 1);
	cursor.setDate(cursor.getDate() - lead);

	const weeks: MonthCell<T>[][] = [];
	const weekdays: WeekdayHeading[] = [];

	for (let week = 0; week < weekCount; week++) {
		const cells: MonthCell<T>[] = [];

		for (let column = 0; column < 7; column++) {
			// The cell is built from the cursor's **fields** and at noon, not by
			// copying its timestamp: this way it doesn't inherit any offset the
			// cursor might be carrying from a time change. See `MonthCell.date`.
			const date = new Date(
				cursor.getFullYear(),
				cursor.getMonth(),
				cursor.getDate(),
				12,
			);
			const key = dayKey(date);

			if (week === 0) {
				weekdays.push({
					short: shortFormat.format(date),
					long: longFormat.format(date),
				});
			}

			cells.push({
				date,
				key,
				inMonth: date.getMonth() === monthIndex,
				isToday: key === todayKey,
				label: labelFormat.format(date),
				day: dayFormat.format(date),
				events: spans
					.filter(
						([, span]) => span !== null && key >= span[0] && key <= span[1],
					)
					.map(([event]) => event),
			});

			cursor.setDate(cursor.getDate() + 1);
		}

		weeks.push(cells);
	}

	return {
		month: first,
		title: new Intl.DateTimeFormat(tag, {
			year: "numeric",
			month: "long",
		}).format(first),
		weekdays,
		weeks,
		undated: spans.filter(([, span]) => span === null).map(([event]) => event),
	};
}
