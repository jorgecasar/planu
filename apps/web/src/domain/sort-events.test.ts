import { expect, test } from "vitest";
import type { PlanuEvent } from "../lib/types.js";
import {
	DEFAULT_SORT,
	groupEvents,
	groupOf,
	OFFERED_SORTS,
	parseSortPreference,
	serializeSortPreference,
	shouldRevealPast,
	sortEvents,
	sortOptions,
} from "./sort-events.js";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

const event = (overrides: Partial<PlanuEvent> = {}): PlanuEvent => ({
	title: "Concierto",
	description: "Música en directo",
	location: "Madrid",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: "u1",
	memberIds: ["u1"],
	roles: {},
	allDay: true,
	tags: [],
	createdAt: null,
	...overrides,
});

const titles = (events: readonly PlanuEvent[]) => events.map((e) => e.title);

// ── Orden por fecha de inicio ────────────────────────────────────────────────

test("por fecha de inicio, ascendente: lo más próximo primero", () => {
	const events = [
		event({ title: "Tarde", startDate: day("2026-09-10") }),
		event({ title: "Pronto", startDate: day("2026-09-01") }),
		event({ title: "Medio", startDate: day("2026-09-05") }),
	];

	expect(
		titles(sortEvents(events, { field: "startDate", direction: "asc" })),
	).toEqual(["Pronto", "Medio", "Tarde"]);
});

test("por fecha de inicio, descendente: se invierte", () => {
	const events = [
		event({ title: "Tarde", startDate: day("2026-09-10") }),
		event({ title: "Pronto", startDate: day("2026-09-01") }),
		event({ title: "Medio", startDate: day("2026-09-05") }),
	];

	expect(
		titles(sortEvents(events, { field: "startDate", direction: "desc" })),
	).toEqual(["Tarde", "Medio", "Pronto"]);
});

test("no toca el array que recibe", () => {
	const events = [
		event({ title: "Tarde", startDate: day("2026-09-10") }),
		event({ title: "Pronto", startDate: day("2026-09-01") }),
	];

	sortEvents(events);
	expect(titles(events)).toEqual(["Tarde", "Pronto"]);
});

test("un evento sólo con fin se ordena por ese fin", () => {
	// Misma semántica que `filterEvents`: con un solo extremo, ese extremo vale
	// por los dos.
	const events = [
		event({ title: "Con inicio", startDate: day("2026-09-05") }),
		event({ title: "Sólo fin", endDate: day("2026-09-01") }),
	];

	expect(titles(sortEvents(events))).toEqual(["Sólo fin", "Con inicio"]);
});

// ── Empates ─────────────────────────────────────────────────────────────────

test("con la misma fecha desempata por título", () => {
	const events = [
		event({ title: "Taller", startDate: day("2026-09-01") }),
		event({ title: "Apertura", startDate: day("2026-09-01") }),
		event({ title: "Comida", startDate: day("2026-09-01") }),
	];

	expect(titles(sortEvents(events))).toEqual(["Apertura", "Comida", "Taller"]);
});

test("el desempate por título no se invierte con la dirección", () => {
	// Decisión: la dirección manda sobre el criterio principal, no sobre el
	// desempate. Un bloque de eventos del mismo día se lee mejor alfabético.
	const events = [
		event({ title: "Taller", startDate: day("2026-09-01") }),
		event({ title: "Apertura", startDate: day("2026-09-01") }),
		event({ title: "Cierre", startDate: day("2026-09-05") }),
	];

	expect(
		titles(sortEvents(events, { field: "startDate", direction: "desc" })),
	).toEqual(["Cierre", "Apertura", "Taller"]);
});

// ── Orden por título ────────────────────────────────────────────────────────

test("por título usa el orden alfabético del idioma activo", () => {
	// En español la «ñ» va entre la «n» y la «o»; con una comparación por
	// unidades de código iría detrás de la «z».
	const events = [
		event({ title: "ñandú" }),
		event({ title: "orden" }),
		event({ title: "nube" }),
	];

	expect(
		titles(sortEvents(events, { field: "title", direction: "asc" }, "es")),
	).toEqual(["nube", "ñandú", "orden"]);
});

test("por título, las mayúsculas no dominan el orden", () => {
	// Con `<` sobre cadenas, "Zapato" iría antes que "arroz" porque las
	// mayúsculas ocupan puntos de código más bajos. El collator no.
	const events = [
		event({ title: "Zapato" }),
		event({ title: "arroz" }),
		event({ title: "Melón" }),
	];

	expect(
		titles(sortEvents(events, { field: "title", direction: "asc" }, "es")),
	).toEqual(["arroz", "Melón", "Zapato"]);
});

test("por título, descendente", () => {
	const events = [
		event({ title: "arroz" }),
		event({ title: "Zapato" }),
		event({ title: "Melón" }),
	];

	expect(
		titles(sortEvents(events, { field: "title", direction: "desc" }, "es")),
	).toEqual(["Zapato", "Melón", "arroz"]);
});

// ── Orden por fecha de creación ─────────────────────────────────────────────

test("por fecha de creación, lo más reciente primero", () => {
	const events = [
		event({ title: "Antiguo", createdAt: day("2026-01-01") }),
		event({ title: "Nuevo", createdAt: day("2026-08-01") }),
	];

	expect(
		titles(sortEvents(events, { field: "createdAt", direction: "desc" })),
	).toEqual(["Nuevo", "Antiguo"]);
});

test("sin fecha de creación va al final en las dos direcciones", () => {
	// Lo desconocido no encabeza una lista sólo por invertirla: los documentos
	// heredados del prototipo no traen `createdAt` y saldrían todos arriba.
	const events = [
		event({ title: "Sin dato", createdAt: null }),
		event({ title: "Antiguo", createdAt: day("2026-01-01") }),
		event({ title: "Nuevo", createdAt: day("2026-08-01") }),
	];

	expect(
		titles(sortEvents(events, { field: "createdAt", direction: "asc" })),
	).toEqual(["Antiguo", "Nuevo", "Sin dato"]);
	expect(
		titles(sortEvents(events, { field: "createdAt", direction: "desc" })),
	).toEqual(["Nuevo", "Antiguo", "Sin dato"]);
});

test("varios sin fecha de creación quedan alfabéticos entre ellos", () => {
	const events = [
		event({ title: "Zeta", createdAt: null }),
		event({ title: "Alfa", createdAt: null }),
	];

	expect(
		titles(sortEvents(events, { field: "createdAt", direction: "desc" })),
	).toEqual(["Alfa", "Zeta"]);
});

// ── Grupos ──────────────────────────────────────────────────────────────────

const NOW = day("2026-06-15");

test("pasado es haber terminado, no haber empezado", () => {
	const enCurso = event({
		title: "Congreso",
		startDate: day("2026-06-14"),
		endDate: day("2026-06-17"),
	});
	const terminado = event({
		title: "Feria",
		startDate: day("2026-06-01"),
		endDate: day("2026-06-02"),
	});

	expect(groupOf(enCurso, NOW)).toBe("upcoming");
	expect(groupOf(terminado, NOW)).toBe("past");
});

test("lo que acaba justo en el instante de corte todavía es próximo", () => {
	// Límite inclusivo, igual que el del rango en `filterEvents`.
	const justo = event({ startDate: day("2026-06-01"), endDate: NOW });
	expect(groupOf(justo, NOW)).toBe("upcoming");

	const unMsAntes = event({
		startDate: day("2026-06-01"),
		endDate: new Date(NOW.getTime() - 1),
	});
	expect(groupOf(unMsAntes, NOW)).toBe("past");
});

test("sin ninguna de las dos fechas, grupo propio", () => {
	expect(groupOf(event({ startDate: null, endDate: null }), NOW)).toBe(
		"undated",
	);
});

test("tener una sola de las dos fechas ya es tener fecha", () => {
	// La misma regla que `filterEvents`: sólo se libra del rango el que no
	// tiene ninguna. Con una basta para situarlo en el tiempo.
	expect(groupOf(event({ startDate: day("2026-07-01") }), NOW)).toBe(
		"upcoming",
	);
	expect(groupOf(event({ endDate: day("2026-07-01") }), NOW)).toBe("upcoming");
	expect(groupOf(event({ endDate: day("2026-05-01") }), NOW)).toBe("past");
});

test("sin fin declarado, un evento que ya empezó sigue en curso", () => {
	// Lo encontró una revisión juntando las tres vistas, y era una
	// contradicción de producto: la rejilla mensual pinta estas obras en la
	// celda de hoy —`eventSpan` las considera abiertas hacia adelante— mientras
	// que aquí caían en «pasado» al día siguiente de empezar. El mismo evento,
	// en curso en el calendario y archivado en la agenda.
	//
	// Manda el calendario, que es la semántica que se eligió en T20.
	const obras = event({
		title: "Obras en la calle",
		startDate: day("2026-06-10"),
	});

	expect(groupOf(obras, NOW)).toBe("upcoming");
	// Y no es que «todo lo que empezó» siga en curso: con fin declarado y
	// pasado, es pasado.
	expect(
		groupOf(
			event({ startDate: day("2026-06-10"), endDate: day("2026-06-12") }),
			NOW,
		),
	).toBe("past");
});

test("con el fin antes del inicio manda el inicio", () => {
	// Dato incoherente que el esquema ya rechaza, pero que pudo guardarse antes.
	// Con `endDate` mandando, este evento aparecía **dentro del pliegue de
	// pasados bajo un encabezado de día futuro**, que es una pantalla que se
	// contradice a sí misma. `eventSpan` colapsa al inicio; aquí, lo mismo.
	const incoherente = event({
		startDate: day("2026-06-20"),
		endDate: day("2026-06-10"),
	});

	expect(groupOf(incoherente, NOW)).toBe("upcoming");
});

test("los eventos sin fecha no se cuelan entre los fechados", () => {
	const events = [
		event({ title: "Sin fecha" }),
		event({ title: "Futuro", startDate: day("2026-07-01") }),
		// Con fin declarado: desde que `groupOf` respeta la semántica del
		// calendario, un evento con sólo inicio no ha terminado nunca, así que
		// «pasado» hay que decirlo poniendo cuándo acabó.
		event({
			title: "Pasado",
			startDate: day("2026-05-01"),
			endDate: day("2026-05-02"),
		}),
	];

	const groups = groupEvents(events, { now: NOW });

	expect(titles(groups.upcoming)).toEqual(["Futuro"]);
	expect(titles(groups.past)).toEqual(["Pasado"]);
	expect(titles(groups.undated)).toEqual(["Sin fecha"]);
});

test("el criterio elegido vale dentro de cada grupo", () => {
	const events = [
		event({ title: "Futuro pronto", startDate: day("2026-07-01") }),
		event({ title: "Futuro tarde", startDate: day("2026-08-01") }),
		event({
			title: "Pasado viejo",
			startDate: day("2026-01-01"),
			endDate: day("2026-01-02"),
		}),
		event({
			title: "Pasado reciente",
			startDate: day("2026-05-01"),
			endDate: day("2026-05-02"),
		}),
	];

	const groups = groupEvents(events, {
		now: NOW,
		sort: { field: "startDate", direction: "desc" },
	});

	expect(titles(groups.upcoming)).toEqual(["Futuro tarde", "Futuro pronto"]);
	expect(titles(groups.past)).toEqual(["Pasado reciente", "Pasado viejo"]);
});

test("agrupar con el orden por defecto no pierde ningún evento", () => {
	const events = [
		event({ title: "A" }),
		event({ title: "B", startDate: day("2026-07-01") }),
		event({ title: "C", startDate: day("2026-05-01") }),
	];

	const groups = groupEvents(events, { now: NOW });
	const total =
		groups.upcoming.length + groups.past.length + groups.undated.length;

	expect(total).toBe(events.length);
});

// ── Preferencia ─────────────────────────────────────────────────────────────

test("el valor por defecto es la fecha de inicio ascendente", () => {
	expect(DEFAULT_SORT).toEqual({ field: "startDate", direction: "asc" });
});

test("lo guardado se vuelve a leer igual", () => {
	const preference = { field: "createdAt", direction: "desc" } as const;
	expect(parseSortPreference(serializeSortPreference(preference))).toEqual(
		preference,
	);
});

test("un valor corrupto cae al orden por defecto", () => {
	for (const raw of [
		null,
		undefined,
		"",
		"basura",
		"startDate",
		"startDate:arriba",
		"prioridad:asc",
		'{"field":"title"}',
		"startDate:asc:extra",
	]) {
		expect(parseSortPreference(raw)).toEqual(DEFAULT_SORT);
	}
});

test("un orden válido que el selector no ofrece también cae al por defecto", () => {
	// `title:desc` es un `SortPreference` legítimo y `sortEvents` lo sabe
	// ordenar, pero no hay opción que pintarlo: aceptarlo desde `localStorage`
	// dejaría el selector con la etiqueta en blanco.
	expect(parseSortPreference("title:desc")).toEqual(DEFAULT_SORT);
	expect(parseSortPreference("createdAt:asc")).toEqual(DEFAULT_SORT);
});

test("el objeto devuelto no es el propio DEFAULT_SORT", () => {
	// El tipo de retorno es mutable, así que devolver la constante compartida
	// dejaría al llamante cambiándola a través del alias. `as const` protege la
	// referencia directa, no una blanqueada por un retorno mutable.
	expect(parseSortPreference("basura")).not.toBe(DEFAULT_SORT);
	expect(parseSortPreference("title:asc")).not.toBe(OFFERED_SORTS[2]);
});

// ── El formato de cable y lo que ofrece el selector ─────────────────────────

test("las cadenas guardadas son exactamente éstas", () => {
	// Formato persistido: cambiarlo descarta en silencio la preferencia de todo
	// el que ya tuviera una. Aserción literal y no sólo de ida y vuelta, que es
	// invariante ante un cambio de separador hecho en los dos lados a la vez.
	expect(
		serializeSortPreference({ field: "startDate", direction: "asc" }),
	).toBe("startDate:asc");
	expect(
		serializeSortPreference({ field: "startDate", direction: "desc" }),
	).toBe("startDate:desc");
	expect(serializeSortPreference({ field: "title", direction: "asc" })).toBe(
		"title:asc",
	);
	expect(
		serializeSortPreference({ field: "createdAt", direction: "desc" }),
	).toBe("createdAt:desc");
});

test("el selector ofrece los cuatro órdenes de la aceptación", () => {
	expect(sortOptions().map((option) => option.value)).toEqual([
		"startDate:asc",
		"startDate:desc",
		"title:asc",
		"createdAt:desc",
	]);
});

test("cada opción trae etiqueta y se puede volver a leer", () => {
	for (const option of sortOptions()) {
		expect(option.label).not.toBe("");
		expect(option.label).not.toBe(option.value);
		expect(parseSortPreference(option.value)).toEqual(option.preference);
	}
});

test("el orden por defecto es uno de los que el selector ofrece", () => {
	// Si no, el primer arranque dejaría el control sin opción marcada.
	expect(OFFERED_SORTS.map(serializeSortPreference)).toContain(
		serializeSortPreference(DEFAULT_SORT),
	);
});

// ── Apertura del grupo de pasados ───────────────────────────────────────────

const disclosure = (
	counts: Partial<Parameters<typeof shouldRevealPast>[0]> = {},
) => ({ upcoming: 0, undated: 0, past: 0, narrowed: false, ...counts });

test("sin pasados no hay nada que abrir", () => {
	expect(shouldRevealPast(disclosure({ upcoming: 3 }))).toBe(false);
});

test("plegado cuando hay otros grupos y nadie ha pedido nada", () => {
	expect(shouldRevealPast(disclosure({ upcoming: 2, past: 5 }))).toBe(false);
	expect(shouldRevealPast(disclosure({ undated: 1, past: 5 }))).toBe(false);
});

test("abierto si los pasados son lo único que hay", () => {
	// Si no, la página queda con una franja de acordeón cerrada y cero
	// tarjetas, sin llegar siquiera al mensaje de lista vacía.
	expect(shouldRevealPast(disclosure({ past: 3 }))).toBe(true);
});

test("abierto si el usuario ha buscado o ha filtrado por fechas", () => {
	// Tres eventos ya terminados que casan con la búsqueda no pueden quedar
	// escondidos: responder a una pregunta explícita con un cajón cerrado es no
	// responderla.
	expect(
		shouldRevealPast(disclosure({ upcoming: 2, past: 3, narrowed: true })),
	).toBe(true);
});

test("buscar no abre un pliegue que no tiene nada dentro", () => {
	expect(
		shouldRevealPast(disclosure({ upcoming: 2, past: 0, narrowed: true })),
	).toBe(false);
});
