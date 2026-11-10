import { expect, test } from "vitest";
import {
	type DateFields,
	fromDateFields,
	toDateFields,
} from "./date-fields.js";

const empty: DateFields = {
	startDate: "",
	startTime: "",
	endDate: "",
	endTime: "",
};

/** Local date and time, so the test doesn't depend on the runner's zone. */
const at = (
	year: number,
	month: number,
	dayOfMonth: number,
	hour = 0,
	minute = 0,
) => new Date(year, month - 1, dayOfMonth, hour, minute);

// ── fromDateFields ───────────────────────────────────────────────────────────

test("sin ningún campo no hay fechas y el evento es de día completo", () => {
	expect(fromDateFields(empty)).toEqual({
		startDate: null,
		endDate: null,
		allDay: true,
	});
});

test("sólo fechas: día completo, a medianoche local", () => {
	expect(
		fromDateFields({
			...empty,
			startDate: "2026-07-04",
			endDate: "2026-07-05",
		}),
	).toEqual({
		startDate: at(2026, 7, 4),
		endDate: at(2026, 7, 5),
		allDay: true,
	});
});

test("con hora de inicio el evento entero pasa a tener hora", () => {
	expect(
		fromDateFields({
			...empty,
			startDate: "2026-07-04",
			startTime: "19:30",
			endDate: "2026-07-04",
		}),
	).toEqual({
		startDate: at(2026, 7, 4, 19, 30),
		endDate: at(2026, 7, 4),
		allDay: false,
	});
});

test("basta la hora de fin para que tenga hora", () => {
	expect(
		fromDateFields({ ...empty, endDate: "2026-07-04", endTime: "23:00" }),
	).toEqual({ startDate: null, endDate: at(2026, 7, 4, 23), allDay: false });
});

test("una hora sin ninguna fecha sigue siendo de día completo", () => {
	expect(
		fromDateFields({ ...empty, startTime: "10:00", endTime: "11:00" }),
	).toEqual({ startDate: null, endDate: null, allDay: true });
});

// ── toDateFields ─────────────────────────────────────────────────────────────

test("un evento con hora rellena los cuatro campos", () => {
	expect(
		toDateFields({
			startDate: at(2026, 7, 4, 19, 30),
			endDate: at(2026, 7, 4, 23),
			allDay: false,
		}),
	).toEqual({
		startDate: "2026-07-04",
		startTime: "19:30",
		endDate: "2026-07-04",
		endTime: "23:00",
	});
});

test("de día completo, o sin la bandera, deja vacías las horas", () => {
	const period = { startDate: at(2026, 7, 4, 9), endDate: null };
	const expected = { ...empty, startDate: "2026-07-04" };
	expect(toDateFields({ ...period, allDay: true })).toEqual(expected);
	expect(toDateFields(period)).toEqual(expected);
});

test("un borrador vacío deja vacíos los cuatro campos", () => {
	expect(toDateFields({})).toEqual(empty);
});

test("ida y vuelta conserva un periodo con hora", () => {
	const period = {
		startDate: at(2026, 7, 4, 19, 30),
		endDate: at(2026, 7, 5, 1, 15),
		allDay: false,
	};
	expect(fromDateFields(toDateFields(period))).toEqual(period);
});
