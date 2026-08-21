import { expect, test } from "vitest";
import type { PlanuEvent } from "../lib/types.js";
import {
	buildMonthGrid,
	dayKey,
	fallbackFirstDayOfWeek,
	firstDayOfWeek,
	safeLocale,
} from "./month-grid.js";

/**
 * Local date from "2026-06-30" or "2026-06-30T18:30".
 *
 * With no `Z` and no offset, the parser interprets it in the environment's
 * timezone, which is exactly what we want: the calendar speaks in local days.
 * The timezone is fixed by the `test` script in `package.json` —not
 * `vite.config.ts`, where Playwright's pin turned out to be inert— so that
 * CI exercises the same thing as here.
 */
function local(text: string): Date {
	return new Date(text.includes("T") ? text : `${text}T12:00`);
}

function event(
	title: string,
	start?: string,
	end?: string,
): PlanuEvent & { id: string } {
	return {
		id: title,
		title,
		startDate: start ? local(start) : null,
		endDate: end ? local(end) : null,
		memberIds: [],
		roles: {},
		tags: [],
	};
}

/** All the grid's cells, from the first to the last. */
function cells(grid: ReturnType<typeof buildMonthGrid>) {
	return grid.weeks.flat();
}

/** The titles of the events in a given day's cell. */
function titlesOn(
	grid: ReturnType<typeof buildMonthGrid>,
	key: number,
): string[] {
	const cell = cells(grid).find((candidate) => candidate.key === key);
	return (cell?.events ?? []).map((found) => found.title);
}

test("dayKey identifica el día local como entero comparable", () => {
	expect(dayKey(local("2026-06-29"))).toBe(20260629);
	expect(dayKey(local("2026-06-29T23:59"))).toBe(20260629);
	expect(dayKey(local("2026-01-01T00:30"))).toBe(20260101);
});

test("la semana empieza el lunes en español y el domingo en inglés de EE. UU.", () => {
	expect(firstDayOfWeek("es")).toBe(1);
	expect(firstDayOfWeek("en-US")).toBe(0);

	const spanish = buildMonthGrid([], local("2026-06-15"), "es");
	const american = buildMonthGrid([], local("2026-06-15"), "en-US");

	expect(spanish.weekdays[0]?.long).toBe("lunes");
	expect(american.weekdays[0]?.long).toBe("Sunday");

	// June 1, 2026 is a Monday: in Spanish there's no leading filler, and in
	// US English the grid starts on Sunday, May 31.
	expect(cells(spanish)[0]?.key).toBe(20260601);
	expect(cells(american)[0]?.key).toBe(20260531);
});

test("el respaldo del primer día coincide con getWeekInfo cuando no lo hay", () => {
	// It's tested separately because in Chromium `getWeekInfo()` always
	// exists and this path would never get exercised: a broken fallback would
	// ship without us noticing.
	expect(fallbackFirstDayOfWeek("es")).toBe(1);
	expect(fallbackFirstDayOfWeek("es-MX")).toBe(0);
	expect(fallbackFirstDayOfWeek("en")).toBe(0);
	expect(fallbackFirstDayOfWeek("en-US")).toBe(0);
	expect(fallbackFirstDayOfWeek("en-GB")).toBe(1);
	expect(fallbackFirstDayOfWeek("de-DE")).toBe(1);
	expect(fallbackFirstDayOfWeek("ar-EG")).toBe(6);
	expect(fallbackFirstDayOfWeek("dv-MV")).toBe(5);
	expect(fallbackFirstDayOfWeek(undefined)).toBe(1);
});

test("una extensión de dos letras no se confunde con una región", () => {
	// In `de-u-ca-gregory` the first two-letter chunk is `ca`. Splitting the
	// tag on hyphens mistook it for Canada and left German starting the week
	// on Sunday. The region comes from `maximize()`.
	expect(fallbackFirstDayOfWeek("de-u-ca-gregory")).toBe(1);
	expect(firstDayOfWeek("de-u-ca-gregory")).toBe(1);
	expect(fallbackFirstDayOfWeek("es-u-nu-latn")).toBe(1);
});

test("el respaldo es una réplica del ICU en las 676 regiones, no una aproximación", () => {
	// The code comment promises that the two paths agree; this turns it into
	// an oracle. A hand-written table mistook Saturday for Monday in fourteen
	// Arabic regions and couldn't even represent the Maldives' Friday.
	const discrepancies: string[] = [];

	for (let a = 65; a <= 90; a++) {
		for (let b = 65; b <= 90; b++) {
			const tag = `und-${String.fromCharCode(a)}${String.fromCharCode(b)}`;
			const icu = firstDayOfWeek(tag);
			const table = fallbackFirstDayOfWeek(tag);
			if (icu !== table) discrepancies.push(`${tag}: ICU ${icu} ≠ ${table}`);
		}
	}

	expect(discrepancies).toEqual([]);
});

test("una etiqueta de locale inválida no revienta la rejilla", () => {
	// And "the grid" is the whole grid, not just `firstDayOfWeek()`: there
	// are four `Intl.DateTimeFormat`s constructed here, and any of them would
	// throw `RangeError` with a malformed tag.
	const bad = "no-es-un-locale-!!";

	expect(() => firstDayOfWeek(bad)).not.toThrow();
	expect(() => buildMonthGrid([], local("2026-06-15"), bad)).not.toThrow();

	const grid = buildMonthGrid(
		[],
		local("2026-06-15"),
		bad,
		local("2026-06-17"),
	);
	expect(cells(grid)).toHaveLength(35);
	expect(grid.title).not.toBe("");
	expect(safeLocale(bad)).toBeUndefined();
	expect(safeLocale("es")).toBe("es");
});

test("la fecha de la celda va al mediodía y no arrastra el cambio de hora", () => {
	// `setDate()` keeps the cursor's time, so an offset inherited from a time
	// change would stay for the rest of the grid. `date` is a public field
	// —T22's `.ics` is its next consumer— and has to hold up on its own, not
	// just compared to another one in the same grid.
	const grid = buildMonthGrid([], local("2026-10-05"), "es");

	expect(cells(grid).every((cell) => cell.date.getHours() === 12)).toBe(true);
	expect(grid.month.getHours()).toBe(12);
});

test("el título y las etiquetas de celda salen del locale", () => {
	const spanish = buildMonthGrid([], local("2026-06-15"), "es");
	const american = buildMonthGrid([], local("2026-06-15"), "en-US");

	expect(spanish.title).toBe("junio de 2026");
	expect(american.title).toBe("June 2026");

	expect(cells(spanish)[0]?.label).toBe("lunes, 1 de junio de 2026");
	expect(cells(american)[1]?.label).toBe("Monday, June 1, 2026");
});

test("un mes de 28 días que empieza en el primer día de la semana ocupa cuatro", () => {
	// February 2027: 28 days and it starts on a Monday, so in Spanish it fits
	// exactly and drags in no foreign day.
	const grid = buildMonthGrid([], local("2027-02-10"), "es");

	expect(grid.weeks).toHaveLength(4);
	expect(cells(grid)).toHaveLength(28);
	expect(cells(grid).every((cell) => cell.inMonth)).toBe(true);
});

test("el mismo mes de 28 días necesita cinco semanas en inglés de EE. UU.", () => {
	// The first day of the week changes the grid's shape, not just the
	// header: with Sunday leading, one more week is needed.
	const grid = buildMonthGrid([], local("2027-02-10"), "en-US");

	expect(grid.weeks).toHaveLength(5);
	expect(cells(grid)[0]?.key).toBe(20270131);
});

test("un mes de 31 días arrastra días del anterior y del siguiente", () => {
	// March 2026 starts on a Sunday: in Spanish the whole previous week is
	// needed up front, making six weeks.
	const grid = buildMonthGrid([], local("2026-03-15"), "es");
	const all = cells(grid);

	expect(grid.weeks).toHaveLength(6);
	expect(all).toHaveLength(42);

	expect(all[0]?.key).toBe(20260223);
	expect(all[0]?.inMonth).toBe(false);
	expect(all[41]?.key).toBe(20260405);
	expect(all[41]?.inMonth).toBe(false);

	expect(all.filter((cell) => cell.inMonth)).toHaveLength(31);
});

/**
 * The months in 2026 in which the **active zone** changes its time offset.
 *
 * Neither a zone nor a month is hardcoded: `vite.config.ts`'s pin turned out
 * to be inert —`contextOptions.timezoneId` doesn't reach the browser, the
 * process's environment variable wins— so a test tied to Madrid started
 * testing something else as soon as somebody exported `TZ`. By looking for
 * the transition wherever it actually is, the test holds in Madrid, in
 * Santiago, or in Auckland.
 */
function transitionMonths(year: number): number[] {
	const months: number[] = [];
	for (let month = 0; month < 12; month++) {
		const primero = new Date(year, month, 1).getTimezoneOffset();
		const ultimo = new Date(year, month + 1, 0).getTimezoneOffset();
		if (primero !== ultimo) months.push(month);
	}
	return months;
}

test("la suite corre en una zona que tiene cambio de horario", () => {
	// Without this, in UTC —which is what GitHub's runners use, because
	// `ci.yml` doesn't fix `TZ`— the test below would find no month to test
	// and would pass without exercising anything. A test that can't fail is
	// worse than none, so this says so out loud instead of staying quiet.
	expect(transitionMonths(2026).length).toBeGreaterThan(0);
});

test("un mes con cambio de horario no repite ni pierde días", () => {
	// Advancing the cursor by adding 86,400,000 ms leaves the day of the
	// change at 23:00 or 01:00 of itself, repaints it, and shifts the whole
	// grid by one day. `setDate()` operates on local fields and doesn't
	// notice.
	for (const month of transitionMonths(2026)) {
		const grid = buildMonthGrid(
			[],
			local(`2026-${`${month + 1}`.padStart(2, "0")}-15`),
			"es",
		);
		const all = cells(grid);
		const inMonth = all.filter((cell) => cell.inMonth).map((cell) => cell.key);

		// Not a single day repeated in the whole grid, and none lost in the
		// month.
		expect(new Set(all.map((cell) => cell.key)).size).toBe(all.length);
		expect(inMonth).toHaveLength(new Date(2026, month + 1, 0).getDate());

		// And consecutive, which is what an accumulated offset would break.
		const dias = inMonth.map((key) => key % 100);
		expect(dias).toEqual(dias.map((_, i) => i + 1));
	}
});

test("un evento de varios días aparece en todas sus celdas", () => {
	const grid = buildMonthGrid(
		[event("Feria", "2026-06-29", "2026-07-02")],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260628)).toEqual([]);
	expect(titlesOn(grid, 20260629)).toEqual(["Feria"]);
	expect(titlesOn(grid, 20260630)).toEqual(["Feria"]);
	// July 1 and 2 are filler cells and they carry it too: otherwise the
	// event would be cut off at the month's edge.
	expect(titlesOn(grid, 20260701)).toEqual(["Feria"]);
	expect(titlesOn(grid, 20260702)).toEqual(["Feria"]);
	expect(titlesOn(grid, 20260703)).toEqual([]);
});

test("un evento que empieza el mes anterior se ve en la parte que cae dentro", () => {
	// July 2026 starts on a Wednesday: the grid drags in June 29 and 30. The
	// event enters through there and stays within the month.
	const grid = buildMonthGrid(
		[event("Congreso", "2026-06-28", "2026-07-02")],
		local("2026-07-15"),
		"es",
	);

	expect(cells(grid)[0]?.key).toBe(20260629);
	expect(titlesOn(grid, 20260629)).toEqual(["Congreso"]);
	expect(titlesOn(grid, 20260630)).toEqual(["Congreso"]);
	expect(titlesOn(grid, 20260701)).toEqual(["Congreso"]);
	expect(titlesOn(grid, 20260702)).toEqual(["Congreso"]);
	expect(titlesOn(grid, 20260703)).toEqual([]);
});

test("la hora del evento no cambia el día en que se pinta", () => {
	// At 23:30 it's still the same local day. Subtracting dates instead of
	// comparing fields would send it to the neighboring cell.
	const grid = buildMonthGrid(
		[event("Verbena", "2026-06-23T23:30", "2026-06-24T00:30")],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260623)).toEqual(["Verbena"]);
	expect(titlesOn(grid, 20260624)).toEqual(["Verbena"]);
	expect(titlesOn(grid, 20260622)).toEqual([]);
	expect(titlesOn(grid, 20260625)).toEqual([]);
});

test("un evento sin fechas no ocupa ninguna celda y sale aparte", () => {
	const undated = event("Algún día");
	const grid = buildMonthGrid([undated], local("2026-06-15"), "es");

	expect(cells(grid).every((cell) => cell.events.length === 0)).toBe(true);
	expect(grid.undated.map((found) => found.title)).toEqual(["Algún día"]);
});

test("sin fecha de fin, el evento sigue en curso hasta el final de la rejilla", () => {
	// A start with no end isn't a point in time: it's something that started
	// and hasn't finished. It's painted as far as the grid reaches, filler
	// included.
	const grid = buildMonthGrid(
		[event("Obras en la calle", "2026-06-10")],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260609)).toEqual([]);
	expect(titlesOn(grid, 20260610)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260625)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260630)).toEqual(["Obras en la calle"]);

	// And through the last cell painted, which already belongs to the next
	// month.
	const ultima = cells(grid).at(-1);
	expect(ultima?.events.map((e) => e.title)).toEqual(["Obras en la calle"]);
});

test("sin fecha de fin, sigue apareciendo en los meses siguientes", () => {
	// What sets it apart from a one-day event: it doesn't get left behind.
	const grid = buildMonthGrid(
		[event("Obras en la calle", "2026-06-10")],
		local("2026-09-15"),
		"es",
	);

	expect(titlesOn(grid, 20260901)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260930)).toEqual(["Obras en la calle"]);
});

test("sin fecha de inicio, va desde hoy hasta el fin", () => {
	// An end with no start is a deadline, and what's useful is seeing how
	// much is left.
	const grid = buildMonthGrid(
		[event("Entregar la declaración", undefined, "2026-06-20")],
		local("2026-06-01"),
		"es",
		local("2026-06-15"),
	);

	expect(titlesOn(grid, 20260614)).toEqual([]);
	expect(titlesOn(grid, 20260615)).toEqual(["Entregar la declaración"]);
	expect(titlesOn(grid, 20260620)).toEqual(["Entregar la declaración"]);
	expect(titlesOn(grid, 20260621)).toEqual([]);
});

test("un plazo ya vencido ocupa sólo su día, no todo el pasado", () => {
	// If the end has already passed, extending it "from today" would paint
	// it backward, and extending it into the past would fill the whole month
	// with something no longer ongoing.
	const grid = buildMonthGrid(
		[event("Plazo vencido", undefined, "2026-06-05")],
		local("2026-06-01"),
		"es",
		local("2026-06-15"),
	);

	expect(titlesOn(grid, 20260604)).toEqual([]);
	expect(titlesOn(grid, 20260605)).toEqual(["Plazo vencido"]);
	expect(titlesOn(grid, 20260606)).toEqual([]);
});

test("un evento con el fin antes del inicio se colapsa al día de inicio", () => {
	// The schema rejects it, but a document saved before could still carry
	// it, and doing nothing would leave it invisible.
	const grid = buildMonthGrid(
		[event("Al revés", "2026-06-10", "2026-06-05")],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260610)).toEqual(["Al revés"]);
	expect(titlesOn(grid, 20260605)).toEqual([]);
});

test("la celda conserva el orden en que llegaron los eventos", () => {
	const grid = buildMonthGrid(
		[
			event("Segundo", "2026-06-10"),
			event("Primero", "2026-06-10"),
			event("Tercero", "2026-06-10"),
		],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260610)).toEqual(["Segundo", "Primero", "Tercero"]);
});

test("hoy se marca en su celda y en ninguna otra", () => {
	const grid = buildMonthGrid(
		[],
		local("2026-06-15"),
		"es",
		local("2026-06-17"),
	);
	const marked = cells(grid).filter((cell) => cell.isToday);

	expect(marked).toHaveLength(1);
	expect(marked[0]?.key).toBe(20260617);
});

test("un hoy fuera del mes no marca ninguna celda", () => {
	const grid = buildMonthGrid(
		[],
		local("2026-06-15"),
		"es",
		local("2027-01-04"),
	);

	expect(cells(grid).some((cell) => cell.isToday)).toBe(false);
});
