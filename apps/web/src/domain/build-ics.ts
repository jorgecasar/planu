/**
 * iCalendar (RFC 5545) generation as text, without touching the DOM or the
 * network.
 *
 * Everything that decides what goes in the file lives here, so that what
 * gets tested is the string and not the browser. The impure part — `Blob`,
 * object URL and `<a download>` — is in `lib/download-file.ts`.
 */

/**
 * The minimum needed to export an event.
 *
 * Structural, not `StoredEvent`, on purpose: this way `domain/` does not
 * depend on `lib/types.ts`, which drags in Zod and Firestore's `Timestamp`.
 * A `StoredEvent` fits here with no conversion.
 */
export interface CalendarEvent {
	id: string;
	title: string;
	description?: string | undefined;
	location?: string | undefined;
	startDate?: Date | null | undefined;
	endDate?: Date | null | undefined;
	/**
	 * Optional, not a bare `boolean`: a document saved before this feature
	 * carries no such field, and `calendarWindow` treats that as all-day —
	 * the implicit migration that avoids re-exporting hundreds of events.
	 */
	allDay?: boolean | undefined;
}

export interface IcsOptions {
	/**
	 * Generation instant, which goes into `DTSTAMP`.
	 *
	 * Mandatory, not defaulted to `new Date()`: with an implicit clock, a test
	 * of the generated file is not reproducible and ends up testing the
	 * system time instead of the format.
	 */
	now: Date;
	/**
	 * Right-hand part of the `UID`, after the at sign. RFC 5545 asks for a
	 * globally unique identifier, and the convention is a domain under our
	 * control.
	 */
	uidDomain?: string;
}

const CRLF = "\r\n";
const PRODID = "-//planu//planu calendar export//EN";
const ENCODER = new TextEncoder();

/** `.ics` files are served like this; the `charset` matters because the text is UTF-8. */
export const ICS_MIME_TYPE = "text/calendar;charset=utf-8";

/**
 * Strips control characters, which RFC 5545 §3.1 does not allow in a value:
 * `VALUE-CHAR = WSP / %x21-7E / NON-US-ASCII`. Only the tab is spared.
 *
 * It is filtered because the title, description and location are free text
 * with no sanitising, and a control character pasted from somewhere else
 * makes several readers reject the **whole** file, not just the property.
 *
 * No regular expression: writing the controls in a character class is
 * exactly what `noControlCharactersInRegex` forbids, and iterating over code
 * points reads just as well.
 */
function stripControls(value: string): string {
	let clean = "";
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		// Tab, or anything from the space character up that is not DEL.
		if (code === 0x09 || (code >= 0x20 && code !== 0x7f)) clean += char;
	}
	return clean;
}

/**
 * Escapes a TEXT value.
 *
 * The backslash goes first: escaping it later would double the backslashes
 * that the other replacements just introduced, and the text would arrive at
 * the calendar corrupted.
 *
 * Line breaks are converted before filtering controls, so that a multi-line
 * description keeps its lines instead of losing them.
 */
export function escapeText(value: string): string {
	return stripControls(
		value
			.replace(/\\/g, "\\\\")
			.replace(/;/g, "\\;")
			.replace(/,/g, "\\,")
			.replace(/\r\n|\r|\n/g, "\\n"),
	);
}

/**
 * Folds a line at 75 **octets**, not 75 characters.
 *
 * That is the difference that makes a file with accents or emoji invalid:
 * in UTF-8 a character takes from one to four octets, so 75 characters can
 * be 300 octets. It iterates by code point — `for…of`, not by index — so as
 * not to split a character in half or separate a surrogate pair.
 *
 * Continuation lines start with a space, and that space counts within the
 * limit: hence from the second line onward the budget is 74.
 */
export function foldLine(line: string): string {
	const segments: string[] = [];
	let current = "";
	let bytes = 0;
	let limit = 75;

	for (const char of line) {
		const size = ENCODER.encode(char).length;
		if (bytes + size > limit) {
			segments.push(current);
			current = "";
			bytes = 0;
			// 74, not 75, from the second segment onward: RFC 5545 §3.1 caps the
			// line at 75 octets **including** the space that opens a
			// continuation, so the content has one less to work with. With 75
			// the second line came out at 76 and the file stopped being valid.
			limit = 74;
		}
		current += char;
		bytes += size;
	}
	segments.push(current);

	return segments.join(`${CRLF} `);
}

function pad(value: number, length = 2): string {
	return String(value).padStart(length, "0");
}

/** `YYYYMMDD`, with local components: it is the date the user chose. */
export function toIcsDate(date: Date): string {
	return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * `YYYYMMDDTHHMMSSZ`, in UTC.
 *
 * The `Z` form avoids having to emit a `VTIMEZONE` with the user's zone's
 * daylight-saving rules, which is the other way to make a local time
 * unambiguous.
 */
export function toIcsDateTime(date: Date): string {
	return (
		`${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
		`T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
	);
}

function nextDay(date: Date): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + 1);
	return next;
}

export interface CalendarWindow {
	start: Date;
	/**
	 * End of the event, **exclusive** when it is all-day: the day after the
	 * last one. That is how RFC 5545 defines it and how Google expects it,
	 * which is why this function computes it once instead of leaving it to
	 * every consumer.
	 *
	 * `null` only when the event has a time and declares no end.
	 */
	end: Date | null;
	allDay: boolean;
}

/**
 * When the event happens, or `null` if there is no way to know.
 *
 * Two decisions the model forces:
 * - An event with only an end date is exported starting on that same day,
 *   because RFC 5545 requires `DTSTART` in every `VEVENT` with no `METHOD`.
 * - It is all-day if `event.allDay` says so. Without the field — a document
 *   from before this feature — it is treated as all-day: the implicit
 *   migration, which stops opening an old event from suddenly re-exporting
 *   it as a zero-duration point-in-time appointment.
 */
export function calendarWindow(event: CalendarEvent): CalendarWindow | null {
	const start = event.startDate ?? event.endDate ?? null;
	if (!start) return null;

	const declaredEnd = event.startDate ? (event.endDate ?? null) : null;
	const allDay = event.allDay ?? true;

	if (allDay) return { start, end: nextDay(declaredEnd ?? start), allDay };

	// With a time, an end that is not later than the start is omitted:
	// RFC 5545 §3.8.2.2 requires `DTEND` to be strictly later, and the schema
	// allows start equal to end. A `VEVENT` with a time and no `DTEND` is
	// valid and means zero duration, which is exactly what the user asked
	// for.
	return {
		start,
		end: declaredEnd && declaredEnd > start ? declaredEnd : null,
		allDay,
	};
}

/** An event with no dates at all cannot be exported; it is flagged instead of exported. */
export function isExportable(event: CalendarEvent): boolean {
	return calendarWindow(event) !== null;
}

/**
 * The event's `UID`.
 *
 * Comes from the document's identifier, which is unique within the
 * collection and never changes. That is exactly what RFC 5545 asks for:
 * exporting the same event twice produces the same `UID`, so the calendar
 * **updates** the entry instead of duplicating it, and two different events
 * never collide. A random `UID` — or one derived from the title, which gets
 * edited — would fill the calendar with copies on every export.
 */
function uid(event: CalendarEvent, domain: string): string {
	// With no identifier there is no stable `UID`, and the one that would
	// come out — `@planu.app` or `undefined@planu.app` — would be **the same
	// for everyone**: the calendar would take them for versions of a single
	// event and keep only one. Better to stop here than to empty out
	// someone's calendar. Today none arrives without one, but T20 and T21
	// are starting to walk unsaved drafts around.
	if (!event.id) {
		throw new TypeError("Un evento sin identificador no se puede exportar.");
	}
	return `${event.id}@${domain}`;
}

function veventLines(
	event: CalendarEvent,
	window: CalendarWindow,
	options: Required<IcsOptions>,
): string[] {
	const { start, end, allDay } = window;
	const lines = [
		"BEGIN:VEVENT",
		`UID:${escapeText(uid(event, options.uidDomain))}`,
		`DTSTAMP:${toIcsDateTime(options.now)}`,
		allDay
			? `DTSTART;VALUE=DATE:${toIcsDate(start)}`
			: `DTSTART:${toIcsDateTime(start)}`,
	];

	if (end) {
		lines.push(
			allDay
				? `DTEND;VALUE=DATE:${toIcsDate(end)}`
				: `DTEND:${toIcsDateTime(end)}`,
		);
	}

	lines.push(`SUMMARY:${escapeText(event.title)}`);
	if (event.description) {
		lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	}
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
	lines.push("END:VEVENT");

	return lines;
}

/**
 * Builds the whole calendar.
 *
 * Events with no dates are skipped instead of emitting a `VEVENT` with no
 * `DTSTART`, which causes some calendars to reject the **whole** file: one
 * event fewer is better than a calendar that cannot be imported. The caller
 * checks beforehand with `isExportable()` so it can warn.
 */
export function buildIcs(
	events: readonly CalendarEvent[],
	options: IcsOptions,
): string {
	const resolved: Required<IcsOptions> = {
		now: options.now,
		uidDomain: options.uidDomain ?? "planu.app",
	};

	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${PRODID}`,
		"CALSCALE:GREGORIAN",
	];

	for (const event of events) {
		const window = calendarWindow(event);
		if (!window) continue;
		lines.push(...veventLines(event, window, resolved));
	}

	lines.push("END:VCALENDAR");

	// Folding is applied at the end and to all lines alike: this way no new
	// property can ever be forgotten and left unfolded.
	return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/**
 * File name derived from the title.
 *
 * No accents or punctuation, because the name travels through a download
 * header and through file systems with different rules. If nothing usable
 * is left — a title in another alphabet — it falls back to a generic name
 * rather than to a file named `.ics`.
 */
export function icsFileName(title: string): string {
	const slug = title
		.normalize("NFD")
		// The diacritics that NFD just split off from their letter.
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);

	return `${slug === "" ? "event" : slug}.ics`;
}
