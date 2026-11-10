import { toInputDate, toInputTime } from "./format-dates.js";

/**
 * The editor's four date inputs, as the strings the browser hands over:
 * `YYYY-MM-DD` for the dates, `HH:mm` for the times, `""` when empty.
 */
export interface DateFields {
	startDate: string;
	startTime: string;
	endDate: string;
	endTime: string;
}

/** An event's period as the model stores it. */
export interface EventPeriod {
	startDate: Date | null;
	endDate: Date | null;
	allDay: boolean;
}

/**
 * Fills the four inputs from an event or a draft.
 *
 * An event without `allDay` (older than the flag) reads as all-day, so its
 * time inputs stay empty instead of showing a meaningless midnight.
 */
export function toDateFields(period: {
	startDate?: Date | null | undefined;
	endDate?: Date | null | undefined;
	allDay?: boolean | undefined;
}): DateFields {
	const allDay = period.allDay ?? true;
	return {
		startDate: toInputDate(period.startDate),
		startTime: allDay ? "" : toInputTime(period.startDate),
		endDate: toInputDate(period.endDate),
		endTime: allDay ? "" : toInputTime(period.endDate),
	};
}

/**
 * Reads the four inputs back into the model's period.
 *
 * Decision 4 of the hours spec: the flag belongs to the whole event, not to
 * each endpoint. Writing either time declares it timed; clearing both
 * returns it to all-day.
 *
 * The second clause guards a case the four fields don't prevent: typing
 * only a time with no date at all. With no date, allDay "doesn't mean
 * anything — it's saved as true and never read" (spec's data model
 * section), so a date-less submission stays all-day regardless of what's in
 * the time fields.
 *
 * Dates are built in local time, the browser time of whoever is editing; a
 * date without a time starts at midnight.
 */
export function fromDateFields(fields: DateFields): EventPeriod {
	const allDay =
		(fields.startTime === "" && fields.endTime === "") ||
		(fields.startDate === "" && fields.endDate === "");
	const date = (value: string, time: string) =>
		value === ""
			? null
			: new Date(`${value}T${time === "" ? "00:00" : time}:00`);
	return {
		startDate: date(fields.startDate, fields.startTime),
		endDate: date(fields.endDate, fields.endTime),
		allDay,
	};
}
