import { msg, str } from "@lit/localize";

/**
 * Formats for an `<input type="date">`, which expects YYYY-MM-DD.
 *
 * Using local components, not `toISOString()`: the latter goes through UTC,
 * so east of Greenwich it returned the previous day. An event on the 4th of
 * July reopened as the 3rd, and every edit pushed it back one more day.
 */
export function toInputDate(date: Date | null | undefined): string {
	if (!date) return "";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Formats for an `<input type="time">`, which expects HH:mm.
 *
 * A sibling of `toInputDate` and for the same reason: local components, not
 * UTC, because the input lives in the browser time of whoever is editing.
 */
export function toInputTime(date: Date | null | undefined): string {
	if (!date) return "";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
	...DATE_FORMAT,
	hour: "numeric",
	minute: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour: "numeric",
	minute: "numeric",
};

/** Same local day, so an afternoon event doesn't repeat the date. */
function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/**
 * Readable text for an event's period.
 *
 * The four combinations of present/absent dates multiply by two with
 * `allDay`: all-day formats without an hour, as before; with time, `hour`/
 * `minute` are added and, when start and end fall on the same day, the end
 * doesn't repeat the date — a 7:30pm-to-11pm dinner doesn't need "Jul 4,
 * 2026" twice.
 */
export function formatEventDates(
	start: Date | null | undefined,
	end: Date | null | undefined,
	allDay: boolean,
	locale?: string,
): string {
	const formatFull = (date: Date) =>
		new Intl.DateTimeFormat(
			locale,
			allDay ? DATE_FORMAT : DATE_TIME_FORMAT,
		).format(date);
	const formatTime = (date: Date) =>
		new Intl.DateTimeFormat(locale, TIME_FORMAT).format(date);

	if (start && end) {
		if (!allDay && sameDay(start, end)) {
			return `${formatFull(start)} – ${formatTime(end)}`;
		}
		return `${formatFull(start)} – ${formatFull(end)}`;
	}
	if (start) return msg(str`Starts ${formatFull(start)}`);
	if (end) return msg(str`Ends ${formatFull(end)}`);
	return msg("No specific date");
}
