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

const FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

/**
 * Readable text for an event's period.
 *
 * The four combinations matter: the model allows events with no dates, with
 * only a start, or with only an end, and each case tells the user something
 * different.
 */
export function formatEventDates(
	start: Date | null | undefined,
	end: Date | null | undefined,
	locale?: string,
): string {
	const format = (date: Date) =>
		new Intl.DateTimeFormat(locale, FORMAT).format(date);

	if (start && end) return `${format(start)} – ${format(end)}`;
	if (start) return msg(str`Starts ${format(start)}`);
	if (end) return msg(str`Ends ${format(end)}`);
	return msg("No specific date");
}
