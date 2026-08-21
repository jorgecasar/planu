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
 * Fecha local a partir de «2026-06-30» o «2026-06-30T18:30».
 *
 * Sin `Z` ni desfase, el parser la interpreta en la zona del entorno, que es
 * justo lo que queremos: el calendario habla de días locales. La zona la fija
 * el script `test` de `package.json` —no `vite.config.ts`, donde el pin de
 * Playwright resultó ser inerte— para que en CI se ejercite lo mismo que aquí.
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
		allDay: true,
		tags: [],
	};
}

/** Todas las celdas de la rejilla, de la primera a la última. */
function cells(grid: ReturnType<typeof buildMonthGrid>) {
	return grid.weeks.flat();
}

/** Los títulos de los eventos de la celda de un día concreto. */
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

	// El 1 de junio de 2026 es lunes: en español no hay relleno inicial y en
	// inglés de EE. UU. la rejilla arranca el domingo 31 de mayo.
	expect(cells(spanish)[0]?.key).toBe(20260601);
	expect(cells(american)[0]?.key).toBe(20260531);
});

test("el respaldo del primer día coincide con getWeekInfo cuando no lo hay", () => {
	// Se prueba aparte porque en Chromium `getWeekInfo()` existe siempre y este
	// camino no se ejercitaría nunca: un respaldo roto viajaría sin enterarnos.
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
	// En `de-u-ca-gregory` el primer trozo de dos letras es `ca`. Partir la
	// etiqueta por guiones lo daba por Canadá y dejaba el alemán empezando la
	// semana en domingo. La región sale de `maximize()`.
	expect(fallbackFirstDayOfWeek("de-u-ca-gregory")).toBe(1);
	expect(firstDayOfWeek("de-u-ca-gregory")).toBe(1);
	expect(fallbackFirstDayOfWeek("es-u-nu-latn")).toBe(1);
});

test("el respaldo es una réplica del ICU en las 676 regiones, no una aproximación", () => {
	// El comentario del código promete que las dos rutas coinciden; esto lo
	// convierte en oráculo. Una tabla escrita a ojo daba sábado por lunes en
	// catorce regiones árabes y no podía ni representar el viernes de Maldivas.
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
	// Y «la rejilla» es la rejilla entera, no sólo `firstDayOfWeek()`: son
	// cuatro `Intl.DateTimeFormat` los que se construyen aquí, y cualquiera de
	// ellos lanzaba `RangeError` con una etiqueta mal formada.
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
	// `setDate()` conserva la hora del cursor, así que un desfase heredado de un
	// cambio de hora se quedaría el resto de la rejilla. `date` es campo público
	// —el `.ics` de T22 es su siguiente consumidor— y tiene que valer por sí
	// solo, no sólo comparado con otro de la misma rejilla.
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
	// Febrero de 2027: 28 días y arranca en lunes, así que en español encaja
	// exacto y no arrastra ningún día ajeno.
	const grid = buildMonthGrid([], local("2027-02-10"), "es");

	expect(grid.weeks).toHaveLength(4);
	expect(cells(grid)).toHaveLength(28);
	expect(cells(grid).every((cell) => cell.inMonth)).toBe(true);
});

test("el mismo mes de 28 días necesita cinco semanas en inglés de EE. UU.", () => {
	// El primer día de la semana cambia la forma de la rejilla, no sólo la
	// cabecera: con domingo por delante hace falta una semana más.
	const grid = buildMonthGrid([], local("2027-02-10"), "en-US");

	expect(grid.weeks).toHaveLength(5);
	expect(cells(grid)[0]?.key).toBe(20270131);
});

test("un mes de 31 días arrastra días del anterior y del siguiente", () => {
	// Marzo de 2026 empieza en domingo: en español hace falta toda la semana
	// anterior por delante, y son seis semanas.
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
 * Los meses de 2026 en los que la **zona activa** cambia de horario.
 *
 * No se codifica una zona ni un mes: el pin de `vite.config.ts` resultó ser
 * inerte —`contextOptions.timezoneId` no llega al navegador, manda la variable
 * del proceso— así que un test atado a Madrid pasaba a probar otra cosa en
 * cuanto alguien exportaba `TZ`. Buscando la transición donde de verdad esté,
 * el test vale en Madrid, en Santiago o en Auckland.
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
	// Sin esto, en UTC —que es lo que usan los runners de GitHub, porque
	// `ci.yml` no fija `TZ`— el test de abajo no encontraría ningún mes que
	// probar y pasaría sin ejercitar nada. Un test que no puede fallar es peor
	// que ninguno, así que esto lo dice en voz alta en vez de callarse.
	expect(transitionMonths(2026).length).toBeGreaterThan(0);
});

test("un mes con cambio de horario no repite ni pierde días", () => {
	// Avanzar el cursor sumando 86 400 000 ms deja el día del cambio a las
	// 23:00 o a la 01:00 de sí mismo, lo vuelve a pintar y desplaza la rejilla
	// entera un día. `setDate()` opera sobre campos locales y no se entera.
	for (const month of transitionMonths(2026)) {
		const grid = buildMonthGrid(
			[],
			local(`2026-${`${month + 1}`.padStart(2, "0")}-15`),
			"es",
		);
		const all = cells(grid);
		const inMonth = all.filter((cell) => cell.inMonth).map((cell) => cell.key);

		// Ni un día repetido en toda la rejilla, ni uno perdido en el mes.
		expect(new Set(all.map((cell) => cell.key)).size).toBe(all.length);
		expect(inMonth).toHaveLength(new Date(2026, month + 1, 0).getDate());

		// Y consecutivos, que es lo que rompe el desfase acumulado.
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
	// El 1 y el 2 de julio son celdas de relleno y también lo llevan: si no, el
	// evento se cortaría al llegar al borde del mes.
	expect(titlesOn(grid, 20260701)).toEqual(["Feria"]);
	expect(titlesOn(grid, 20260702)).toEqual(["Feria"]);
	expect(titlesOn(grid, 20260703)).toEqual([]);
});

test("un evento que empieza el mes anterior se ve en la parte que cae dentro", () => {
	// Julio de 2026 empieza en miércoles: la rejilla arrastra el 29 y el 30 de
	// junio. El evento entra por ahí y sigue dentro del mes.
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
	// A las 23:30 sigue siendo el mismo día local. Restar fechas en vez de
	// comparar campos lo llevaría a la celda de al lado.
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
	// Un inicio sin fin no es un punto en el tiempo: es algo que empezó y no ha
	// terminado. Se pinta hasta donde llega la rejilla, relleno incluido.
	const grid = buildMonthGrid(
		[event("Obras en la calle", "2026-06-10")],
		local("2026-06-15"),
		"es",
	);

	expect(titlesOn(grid, 20260609)).toEqual([]);
	expect(titlesOn(grid, 20260610)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260625)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260630)).toEqual(["Obras en la calle"]);

	// Y hasta la última celda pintada, que ya es del mes siguiente.
	const ultima = cells(grid).at(-1);
	expect(ultima?.events.map((e) => e.title)).toEqual(["Obras en la calle"]);
});

test("sin fecha de fin, sigue apareciendo en los meses siguientes", () => {
	// Lo que lo distingue de un evento de un día: no se queda atrás.
	const grid = buildMonthGrid(
		[event("Obras en la calle", "2026-06-10")],
		local("2026-09-15"),
		"es",
	);

	expect(titlesOn(grid, 20260901)).toEqual(["Obras en la calle"]);
	expect(titlesOn(grid, 20260930)).toEqual(["Obras en la calle"]);
});

test("sin fecha de inicio, va desde hoy hasta el fin", () => {
	// Un fin sin inicio es una fecha límite, y lo útil es ver cuánto queda.
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
	// Si el fin ya pasó, extenderlo «desde hoy» lo pintaría al revés, y
	// extenderlo hacia atrás llenaría el mes entero de algo que ya no está en
	// curso.
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
	// El esquema lo rechaza, pero un documento guardado antes podría traerlo y
	// no hacer nada lo dejaría invisible.
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
