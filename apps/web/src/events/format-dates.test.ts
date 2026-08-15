import { expect, test } from "vitest";
import { formatEventDates } from "./format-dates.js";

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
	expect(formatEventDates(undefined, undefined, "en-US")).toBe("No specific date");
});
