import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import { buildAgenda, countEvents } from "./agenda-days.js";
import { buildMonthGrid, dayKey } from "./month-grid.js";

/** Mediodía local, para que ninguna aserción dependa del huso del runner. */
function local(text: string): Date {
	return new Date(text.includes("T") ? text : `${text}T12:00`);
}

function event(
	id: string,
	title: string,
	start: string | null,
	end?: string | null,
): StoredEvent {
	return {
		id,
		title,
		startDate: start ? local(start) : null,
		endDate: end ? local(end) : null,
		memberIds: [],
		roles: {},
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
	// Es la definición de agenda que fija F5: «lista cronológica agrupada por
	// día». La entrada llega desordenada a propósito.
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
	// El orden elegido manda también sobre la secuencia de días: si sólo mandara
	// dentro de cada día, la agenda contradiría al selector.
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
	// Ordenando por título, los dos del día 20 quedan separados por el del 21.
	// Sin agrupar por clave, la agenda enseñaría «20 de junio» dos veces con el
	// 21 en medio, que es un calendario que se contradice a sí mismo.
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
	// Un congreso que empezó hace dos días y acaba dentro de dos sigue siendo
	// próximo, aunque su día de entrada en la agenda ya quedara atrás. Mirar el
	// inicio lo mandaría al pliegue de pasados estando en curso.
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
	// La contradicción que encontró la revisión: la rejilla mensual pinta estas
	// obras en la celda de hoy y la agenda las metía en el pliegue de pasados.
	// Se comprueban **las dos vistas a la vez**, que es lo único que detecta que
	// vuelvan a separarse.
	const obras = event("1", "Obras en la calle", "2026-06-10");
	const agenda = buildAgenda([obras], { now: NOW, locale: "es" });
	const grid = buildMonthGrid([obras], local("2026-06-01"), "es", NOW);
	const hoy = grid.weeks.flat().find((cell) => cell.key === dayKey(NOW));

	expect(countEvents(agenda.upcoming)).toBe(1);
	expect(agenda.past).toHaveLength(0);
	expect(titles(hoy?.events ?? [])).toEqual(["Obras en la calle"]);
});

test("con el fin antes del inicio, agenda y calendario coinciden en el día", () => {
	// Dato incoherente heredado. Antes caía en el pliegue de pasados bajo un
	// encabezado de día **futuro**: una pantalla que se contradice a sí misma.
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
	// El congreso ocupa cinco días. En la rejilla mensual se pinta en los cinco
	// —una línea por celda hace visible el tramo—; aquí repetir la tarjeta
	// entera cinco veces en una lista que se recorre hacia abajo sería ruido.
	const congreso = event("1", "Congreso", "2026-06-20", "2026-06-24");
	const agenda = buildAgenda([congreso], { now: NOW, locale: "es" });

	expect(agenda.upcoming).toHaveLength(1);
	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-20")));
	expect(countEvents(agenda.upcoming)).toBe(1);
});

test("sin inicio, el fin hace de día de entrada", () => {
	// Es lo que ya hace `sortEvents` para ordenarlo: si la agenda agrupara por
	// otro extremo, el evento aparecería fuera de su propio sitio en la lista.
	const agenda = buildAgenda([event("1", "Entrega", null, "2026-06-30")], {
		now: NOW,
		locale: "es",
	});

	expect(agenda.undated).toHaveLength(0);
	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-30")));
});

test("el día se representa al mediodía, no a medianoche", () => {
	// Igual que en `MonthCell`: hay husos donde las 00:00 no existen un día al
	// año —la suite corre en America/Santiago, que es uno— y el motor devuelve
	// la 01:00. El mediodía existe siempre, y `date` es campo público.
	const agenda = buildAgenda([event("1", "Taller", "2026-06-20")], {
		now: NOW,
		locale: "es",
	});

	expect(agenda.upcoming[0]?.date.getHours()).toBe(12);
});

test("un evento a última hora sigue perteneciendo a su día", () => {
	// Con la fecha guardada a las 23:30, agrupar por marca de tiempo en vez de
	// por campos locales lo empujaba al día siguiente en cuanto el huso movía
	// unas horas.
	const agenda = buildAgenda(
		[event("1", "Fin de fiesta", "2026-06-20T23:30")],
		{ now: NOW, locale: "es" },
	);

	expect(agenda.upcoming[0]?.key).toBe(dayKey(local("2026-06-20")));
	expect(agenda.upcoming[0]?.date.getDate()).toBe(20);
});

test("el día se escribe entero y en el idioma pedido", () => {
	// El rótulo es el encabezado del día en la agenda, así que es el nombre por
	// el que se navega. «20/6/2026» no dice qué día de la semana es.
	const agenda = buildAgenda([event("1", "Taller", "2026-06-20")], {
		now: NOW,
		locale: "es",
	});

	expect(labels(agenda.upcoming)).toEqual(["sábado, 20 de junio de 2026"]);
});

test("un locale inválido no deja la agenda sin días", () => {
	// Llega desde `navigator.languages` o desde una URL, y `Intl` lanza
	// `RangeError` con cualquier cosa que no sea una etiqueta BCP 47.
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
	// El límite es inclusivo, igual que en `filterEvents` y en `groupOf`. Sin
	// esto, el evento en curso desaparece al pliegue en el instante exacto en
	// que aún está pasando.
	const agenda = buildAgenda(
		[event("1", "Charla", "2026-06-15T09:00", "2026-06-15T10:00")],
		{
			now: NOW,
			locale: "es",
		},
	);

	expect(countEvents(agenda.upcoming)).toBe(1);
	expect(agenda.past).toHaveLength(0);
});
