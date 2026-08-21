import { expect, test } from "vitest";
import { formatEventDates, toInputDate, toInputTime } from "./format-dates.js";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Fecha y hora locales, para no depender de la zona del entorno de test. */
const at = (
	year: number,
	month: number,
	dayOfMonth: number,
	hour: number,
	minute: number,
) => new Date(year, month - 1, dayOfMonth, hour, minute);

// ── formatEventDates, día completo ──────────────────────────────────────────

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

// ── formatEventDates, con hora ──────────────────────────────────────────────

test("con hora, mismo día, no repite la fecha en el fin", () => {
	// Es la combinación que el spec marca como decisión explícita: repetir
	// «4 jul 2026» dos veces en una cena de una tarde sería ruido.
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
	// Con toISOString(), al este de Greenwich esto devolvía el día anterior:
	// un evento del 4 de julio se reabría como el 3, y cada edición lo retrasaba
	// otro día.
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
