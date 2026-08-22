import { expect, test } from "vitest";
import { formatEventDates, toInputDate, toInputTime } from "./format-dates.js";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Local date and time, so the test doesn't depend on the runner's zone. */
const at = (
	year: number,
	month: number,
	dayOfMonth: number,
	hour: number,
	minute: number,
) => new Date(year, month - 1, dayOfMonth, hour, minute);

// ── formatEventDates, all-day ────────────────────────────────────────────────

test("día completo con inicio y fin muestra el periodo sin hora", () => {
	expect(
		formatEventDates(day("2026-06-12"), day("2026-06-14"), true, "en-US"),
	).toBe("Jun 12, 2026 – Jun 14, 2026");
});

test("día completo con sólo inicio dice cuándo empieza, sin hora", () => {
	expect(formatEventDates(day("2026-06-12"), null, true, "en-US")).toBe(
		"Starts Jun 12, 2026",
	);
});

test("día completo con sólo fin dice cuándo termina, sin hora", () => {
	expect(formatEventDates(null, day("2026-06-14"), true, "en-US")).toBe(
		"Ends Jun 14, 2026",
	);
});

test("día completo sin fechas lo dice explícitamente", () => {
	expect(formatEventDates(null, null, true, "en-US")).toBe("No specific date");
	expect(formatEventDates(undefined, undefined, true, "en-US")).toBe(
		"No specific date",
	);
});

// ── formatEventDates, with time ──────────────────────────────────────────────

test("con hora, mismo día, no repite la fecha en el fin", () => {
	// The combination the spec marks as an explicit decision: repeating
	// "Jul 4, 2026" twice for an evening dinner would be noise.
	expect(
		formatEventDates(
			at(2026, 7, 4, 19, 30),
			at(2026, 7, 4, 23, 0),
			false,
			"en-US",
		),
	).toBe("Jul 4, 2026, 7:30 PM – 11:00 PM");
});

test("con hora, varios días, repite la fecha completa en el fin", () => {
	expect(
		formatEventDates(
			at(2026, 7, 4, 9, 0),
			at(2026, 7, 6, 18, 0),
			false,
			"en-US",
		),
	).toBe("Jul 4, 2026, 9:00 AM – Jul 6, 2026, 6:00 PM");
});

test("con hora, sólo inicio, dice cuándo empieza con la hora", () => {
	expect(formatEventDates(at(2026, 7, 4, 19, 30), null, false, "en-US")).toBe(
		"Starts Jul 4, 2026, 7:30 PM",
	);
});

test("con hora, sólo fin, dice cuándo termina con la hora", () => {
	expect(formatEventDates(null, at(2026, 7, 4, 19, 30), false, "en-US")).toBe(
		"Ends Jul 4, 2026, 7:30 PM",
	);
});

test("sin fechas lo dice igual, tenga o no hora", () => {
	expect(formatEventDates(null, null, false, "en-US")).toBe("No specific date");
});

// ── toInputDate ──────────────────────────────────────────────────────────────

test("formatea para el input usando la fecha local, no UTC", () => {
	// With toISOString(), east of Greenwich this returned the previous day:
	// an event on the 4th of July reopened as the 3rd, and every edit pushed
	// it back another day.
	const local = new Date(2026, 6, 4, 0, 0, 0);
	expect(toInputDate(local)).toBe("2026-07-04");
});

test("rellena mes y día con cero a la izquierda", () => {
	expect(toInputDate(new Date(2026, 0, 5))).toBe("2026-01-05");
});

test("sin fecha devuelve cadena vacía, que es lo que espera el input", () => {
	expect(toInputDate(null)).toBe("");
	expect(toInputDate(undefined)).toBe("");
});

// ── toInputTime ──────────────────────────────────────────────────────────────

test("formatea para el input de hora usando componentes locales", () => {
	expect(toInputTime(at(2026, 7, 4, 19, 30))).toBe("19:30");
});

test("rellena hora y minuto con cero a la izquierda", () => {
	expect(toInputTime(at(2026, 7, 4, 9, 5))).toBe("09:05");
});

test("sin fecha devuelve cadena vacía", () => {
	expect(toInputTime(null)).toBe("");
	expect(toInputTime(undefined)).toBe("");
});
