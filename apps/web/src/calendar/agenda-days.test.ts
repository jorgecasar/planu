import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import { buildAgenda, countEvents } from "./agenda-days.js";
import { buildMonthGrid, dayKey } from "./month-grid.js";

/** Local noon, so no assertion depends on the runner's timezone. */
function local(text: string): Date {
	return new Date(text.includes("T") ? text : `${text}T12:00`);
}

function event(
	id: string,
	title: string,
	start: string | null,
	end?: string | null,
	allDay = true,
): StoredEvent {
	return {
		id,
		title,
		startDate: start ? local(start) : null,
		endDate: end ? local(end) : null,
		memberIds: [],
		roles: {},
		allDay,
		tags: [],
	} satisfies StoredEvent;
}

const NOW = local("2026-06-15T10:00");

const labels = <T>(days: { label: string; events: T[] }[]) =>
	days.map((day) => day.label);

const titles = (events: readonly StoredEvent[]) =>
	events.map((event) => event.title);

test("los eventos del mismo día caen en un solo día", () => {
	const agenda = buildAgenda(
		[
			event("1", "Taller", "2026-06-20"),
			event("2", "Cena", "2026-06-20"),
			event("3", "Concierto", "2026-06-21"),
		],
		{ now: NOW, locale: "es" },
	);

	expect(agenda.upcoming).toHaveLength(2);
	expect(titles(agenda.upcoming[0]?.events ?? [])).toEqual(["Cena", "Taller"]);
	expect(titles(agenda.upcoming[1]?.events ?? [])).toEqual(["Concierto"]);
});

test("con el orden por defecto los días salen en orden cronológico", () => {
	// It's the definition of agenda that F5 fixes: "chronological list grouped
	// by day". The input arrives unordered on purpose.
	const agenda = buildAgenda(
		[
			event("3", "Tercero", "2026-07-01"),
			event("1", "Primero", "2026-06-18"),
			event("2", "Segundo", "2026-06-25"),
		],
		{ now: NOW, locale: "es" },
	);

	expect(titles(agenda.upcoming.flatMap((day) => day.events))).toEqual([
		"Primero",
		"Segundo",
		"Tercero",
	]);
});

test("pidiendo lo más lejano primero, los días se dan la vuelta", () => {
	// The chosen order also governs the sequence of days: if it only governed
	// within each day, the agenda would contradict the selector.
	const agenda = buildAgenda(
		[
			event("1", "Primero", "2026-06-18"),
			event("2", "Segundo", "2026-06-25"),
			event("3", "Tercero", "2026-07-01"),
		],
		{ now: NOW, sort: { field: "startDate", direction: "desc" }, locale: "es" },
	);

	expect(titles(agenda.upcoming.flatMap((day) => day.events))).toEqual([
		"Tercero",
		"Segundo",
		"Primero",
	]);
});

test("un día no se parte en dos aunque sus eventos no lleguen seguidos", () => {
	// Sorting by title, the two from day 20 end up separated by the one from
	// day 21. Without grouping by key, the agenda would show "June 20" twice
	// with the 21st in between, which is a calendar that contradicts itself.
	const agenda = buildAgenda(
		[
			event("1", "Ana", "2026-06-20"),
			event("2", "Bea", "2026-06-21"),
			event("3", "Carlos", "2026-06-20"),
		],
		{ now: NOW, sort: { field: "title", direction: "asc" }, locale: "es" },
	);

	expect(agenda.upcoming).toHaveLength(2);
	expect(titles(agenda.upcoming[0]?.events ?? [])).toEqual(["Ana", "Carlos"]);
	expect(titles(agenda.upcoming[1]?.events ?? [])).toEqual(["Bea"]);
});

test("los eventos sin fecha van aparte y no inventan un día", () => {
	const agenda = buildAgenda(
		[event("1", "Algún día", null), event("2", "Taller", "2026-06-20")],
		{ now: NOW, locale: "es" },
	);

	expect(titles(agenda.undated)).toEqual(["Algún día"]);
	expect(agenda.upcoming).toHaveLength(1);
	expect(agenda.past).toHaveLength(0);
});

test("pasado es haber terminado, no haber empezado", () => {
	// A conference that started two days ago and ends in two more is still
	// upcoming, even though its entry day in the agenda is already behind.
	// Looking at the start would send it to the past fold while still ongoing.
	const agenda = buildAgenda(
		[
			event("1", "Congreso", "2026-06-13", "2026-06-17"),
			event("2", "Feria", "2026-06-01", "2026-06-03"),
		],
		{ now: NOW, locale: "es" },
	);

	expect(titles(agenda.upcoming.flatMap((day) => day.events))).toEqual([
		"Congreso",
	]);
	expect(titles(agenda.past.flatMap((day) => day.events))).toEqual(["Feria"]);
});

test("un evento sin fin sigue en curso, igual que en el calendario", () => {
	// The contradiction the review found: the month grid paints this ongoing
	// work in today's cell, and the agenda put it in the past fold. **Both
	// views are checked at once**, which is the only thing that would catch
	// them diverging again. And `allDay: false` on purpose: an open end can
	// only be declared on a timed event (decision 4 of the hours spec).
	const obras = event("1", "Obras en la calle", "2026-06-10", null, false);
	const agenda = buildAgenda([obras], { now: NOW, locale: "es" });
	const grid = buildMonthGrid([obras], local("2026-06-01"), "es", NOW);
	const hoy = grid.weeks.flat().find((cell) => cell.key === dayKey(NOW));

	expect(countEvents(agenda.upcoming)).toBe(1);
	expect(agenda.past).toHaveLength(0);
	expect(titles(hoy?.events ?? [])).toEqual(["Obras en la calle"]);
});

test("con el fin antes del inicio, agenda y calendario coinciden en el día", () => {
	// Inherited inconsistent data. It used to fall in the past fold under a
	// **future** day heading: a screen that contradicts itself.
	const raro = event("1", "Datos raros", "2026-06-20", "2026-06-10");
	const agenda = buildAgenda([raro], { now: NOW, locale: "es" });
	const grid = buildMonthGrid([raro], local("2026-06-01"), "es", NOW);
	const veinte = grid.weeks
		.flat()
		.find((cell) => cell.key === dayKey(local("2026-06-20")));

	expect(agenda.past).toHaveLength(0);
	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-20")));
	expect(titles(veinte?.events ?? [])).toEqual(["Datos raros"]);
});

test("el evento entra por el día que lo ordena, y una sola vez", () => {
	// The conference spans five days. In the month grid it's painted on all
	// five —one line per cell makes the span visible—; here repeating the
	// whole card five times in a list you scroll through top to bottom would
	// be noise.
	const congreso = event("1", "Congreso", "2026-06-20", "2026-06-24");
	const agenda = buildAgenda([congreso], { now: NOW, locale: "es" });

	expect(agenda.upcoming).toHaveLength(1);
	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-20")));
	expect(countEvents(agenda.upcoming)).toBe(1);
});

test("sin inicio, el fin hace de día de entrada", () => {
	// It's what `sortEvents` already does to order it: if the agenda grouped
	// by a different end, the event would show up out of its own place in the
	// list.
	const agenda = buildAgenda([event("1", "Entrega", null, "2026-06-30")], {
		now: NOW,
		locale: "es",
	});

	expect(agenda.undated).toHaveLength(0);
	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-30")));
});

test("el día se representa al mediodía, no a medianoche", () => {
	// Same as in `MonthCell`: there are timezones where 00:00 doesn't exist one
	// day a year —the suite runs in America/Santiago, which is one— and the
	// engine returns 01:00 instead. Noon always exists, and `date` is a public
	// field.
	const agenda = buildAgenda([event("1", "Taller", "2026-06-20")], {
		now: NOW,
		locale: "es",
	});

	expect(agenda.upcoming[0]?.date.getHours()).toBe(12);
});

test("un evento a última hora sigue perteneciendo a su día", () => {
	// With the date stored at 23:30, grouping by timestamp instead of by local
	// fields pushed it to the next day as soon as the timezone shifted by a
	// few hours.
	const agenda = buildAgenda(
		[event("1", "Fin de fiesta", "2026-06-20T23:30")],
		{ now: NOW, locale: "es" },
	);

	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-20")));
	expect(agenda.upcoming[0]?.date.getDate()).toBe(20);
});

test("el día se escribe entero y en el idioma pedido", () => {
	// The label is the day's heading in the agenda, so it's the name you
	// navigate by. "20/6/2026" doesn't say what day of the week it is.
	const agenda = buildAgenda([event("1", "Taller", "2026-06-20")], {
		now: NOW,
		locale: "es",
	});

	expect(labels(agenda.upcoming)).toEqual(["sábado, 20 de junio de 2026"]);
});

test("un locale inválido no deja la agenda sin días", () => {
	// It arrives from `navigator.languages` or from a URL, and `Intl` throws
	// `RangeError` with anything that isn't a BCP 47 tag.
	const agenda = buildAgenda([event("1", "Taller", "2026-06-20")], {
		now: NOW,
		locale: "no-es-un-locale",
	});

	expect(agenda.upcoming).toHaveLength(1);
	expect(agenda.upcoming[0]?.label).not.toBe("");
});

test("contar eventos suma los de todos los días, no los días", () => {
	const agenda = buildAgenda(
		[
			event("1", "Uno", "2026-06-20"),
			event("2", "Dos", "2026-06-20"),
			event("3", "Tres", "2026-06-21"),
		],
		{ now: NOW, locale: "es" },
	);

	expect(agenda.upcoming).toHaveLength(2);
	expect(countEvents(agenda.upcoming)).toBe(3);
	expect(countEvents([])).toBe(0);
});

test("lo que termina justo ahora todavía cuenta como próximo", () => {
	// The boundary is inclusive, same as in `filterEvents` and in `groupOf`.
	// Without this, the ongoing event disappears into the fold at the exact
	// instant it's still happening. Timed and not all-day: the millisecond
	// precision this test checks only makes sense for a point-in-time
	// appointment, which closes on its own instant instead of at the end of
	// the day (see `sort-events.test.ts` for the all-day case).
	const agenda = buildAgenda(
		[event("1", "Charla", "2026-06-15T09:00", "2026-06-15T10:00", false)],
		{
			now: NOW,
			locale: "es",
		},
	);

	expect(countEvents(agenda.upcoming)).toBe(1);
	expect(agenda.past).toHaveLength(0);
});
