import { expect, test } from "vitest";
import type { CalendarEvent } from "./build-ics.js";
import { googleCalendarUrl } from "./google-calendar-url.js";

const day = (year: number, month: number, date: number) =>
	new Date(year, month - 1, date);

/** Minute 37: it's not midnight in any time zone. See `build-ics.test.ts`. */
const at = (hourUtc: number) => new Date(Date.UTC(2026, 5, 12, hourUtc, 37, 0));

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: "abc123",
	title: "Feria del libro",
	startDate: day(2026, 6, 12),
	allDay: true,
	...extra,
});

const params = (url: string) => new URL(url).searchParams;

test("apunta a la plantilla de Google con el título del evento", () => {
	const url = googleCalendarUrl(event()) ?? "";

	expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(
		true,
	);
	expect(params(url).get("action")).toBe("TEMPLATE");
	expect(params(url).get("text")).toBe("Feria del libro");
});

test("un día completo va con fechas sueltas y fin exclusivo", () => {
	const url =
		googleCalendarUrl(
			event({ startDate: day(2026, 6, 12), endDate: day(2026, 6, 14) }),
		) ?? "";

	expect(params(url).get("dates")).toBe("20260612/20260615");
});

test("un evento con hora va en UTC", () => {
	const url =
		googleCalendarUrl(
			event({ startDate: at(9), endDate: at(11), allDay: false }),
		) ?? "";

	expect(params(url).get("dates")).toBe("20260612T093700Z/20260612T113700Z");
});

test("sin fin declarado se repite el inicio, que es lo que exige el parámetro", () => {
	const url =
		googleCalendarUrl(event({ startDate: at(9), allDay: false })) ?? "";

	expect(params(url).get("dates")).toBe("20260612T093700Z/20260612T093700Z");
});

test("arrastra descripción y ubicación cuando existen", () => {
	const url =
		googleCalendarUrl(
			event({ description: "Trae tu libro", location: "Retiro" }),
		) ?? "";

	expect(params(url).get("details")).toBe("Trae tu libro");
	expect(params(url).get("location")).toBe("Retiro");
});

test("omite los parámetros vacíos en vez de mandarlos en blanco", () => {
	const url = googleCalendarUrl(event()) ?? "";

	expect(params(url).has("details")).toBe(false);
	expect(params(url).has("location")).toBe(false);
});

test("escapa lo que rompería la propia URL", () => {
	// An unescaped `&` would turn the rest of the title into another parameter.
	const url = googleCalendarUrl(event({ title: "Pan & vino, café" })) ?? "";

	expect(params(url).get("text")).toBe("Pan & vino, café");
	expect(url).not.toContain("& vino");
});

test("un evento sin fechas no tiene enlace: se avisa en su lugar", () => {
	expect(googleCalendarUrl(event({ startDate: null, endDate: null }))).toBe(
		null,
	);
});
