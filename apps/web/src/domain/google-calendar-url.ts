import {
	type CalendarEvent,
	calendarWindow,
	toIcsDate,
	toIcsDateTime,
} from "./build-ics.js";

/**
 * Link to Google Calendar's event-creation template.
 *
 * It's a URL, not an integration: there's no network call, no credentials,
 * no permission to ask for. The user lands on Google's form with the fields
 * filled in and decides whether to save it.
 *
 * The template only accepts **one** event, so the full agenda is only
 * exported as `.ics`.
 */
const TEMPLATE = "https://calendar.google.com/calendar/render";

/**
 * `null` when the event has no dates: without `dates` the template opens
 * with an empty schedule and the user thinks the link failed. The caller
 * warns instead.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
	const window = calendarWindow(event);
	if (!window) return null;

	const { start, end, allDay } = window;
	// Google uses the same criterion as RFC 5545: bare dates for the all-day
	// case —with an exclusive end, already computed— and a UTC timestamp for
	// the rest. With no end declared, the start is repeated, because the
	// parameter requires both ends.
	const dates = allDay
		? `${toIcsDate(start)}/${toIcsDate(end ?? start)}`
		: `${toIcsDateTime(start)}/${toIcsDateTime(end ?? start)}`;

	// `URLSearchParams` takes care of escaping; building the string by hand is
	// where a title with `&` would break the rest of the parameters.
	const params = new URLSearchParams({
		action: "TEMPLATE",
		text: event.title,
		dates,
	});
	if (event.description) params.set("details", event.description);
	if (event.location) params.set("location", event.location);

	return `${TEMPLATE}?${params.toString()}`;
}
