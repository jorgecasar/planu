import { expect, test } from "vitest";
import { formatEventDates, toInputDate } from "./format-dates.js";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

test("con inicio y fin muestra el periodo", () => {
	expect(formatEventDates(day("2026-06-12"), day("2026-06-14"), "en-US")).toBe(
		"Jun 12, 2026 – Jun 14, 2026",
	);
});

test("con sólo inicio dice cuándo empieza", () => {
	expect(formatEventDates(day("2026-06-12"), null, "en-US")).toBe(
		"Starts Jun 12, 2026",
	);
});

test("con sólo fin dice cuándo termina", () => {
	expect(formatEventDates(null, day("2026-06-14"), "en-US")).toBe(
		"Ends Jun 14, 2026",
	);
});

test("sin fechas lo dice explícitamente en vez de quedar en blanco", () => {
	expect(formatEventDates(null, null, "en-US")).toBe("No specific date");
	expect(formatEventDates(undefined, undefined, "en-US")).toBe(
		"No specific date",
	);
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
