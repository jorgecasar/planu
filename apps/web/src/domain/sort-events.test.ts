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

// ── Sort by start date ───────────────────────────────────────────────────────

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
	// Same semantics as `filterEvents`: with only one end, that end stands
	// in for both.
	const events = [
		event({ title: "Con inicio", startDate: day("2026-09-05") }),
		event({ title: "Sólo fin", endDate: day("2026-09-01") }),
	];

	expect(titles(sortEvents(events))).toEqual(["Sólo fin", "Con inicio"]);
});

// ── Ties ──────────────────────────────────────────────────────────────────────

test("con la misma fecha desempata por título", () => {
	const events = [
		event({ title: "Taller", startDate: day("2026-09-01") }),
		event({ title: "Apertura", startDate: day("2026-09-01") }),
		event({ title: "Comida", startDate: day("2026-09-01") }),
	];

	expect(titles(sortEvents(events))).toEqual(["Apertura", "Comida", "Taller"]);
});

test("el desempate por título no se invierte con la dirección", () => {
	// Decision: the direction rules the primary criterion, not the
	// tiebreaker. A block of events on the same day reads better alphabetical.
	const events = [
		event({ title: "Taller", startDate: day("2026-09-01") }),
		event({ title: "Apertura", startDate: day("2026-09-01") }),
		event({ title: "Cierre", startDate: day("2026-09-05") }),
	];

	expect(
		titles(sortEvents(events, { field: "startDate", direction: "desc" })),
	).toEqual(["Cierre", "Apertura", "Taller"]);
});

// ── Sort by title ────────────────────────────────────────────────────────────

test("por título usa el orden alfabético del idioma activo", () => {
	// In Spanish collation, n with a tilde sorts between "n" and "o"; a plain
	// code-unit comparison would put it after "z".
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
	// With `<` on strings, "Zapato" would come before "arroz" because
	// uppercase letters occupy lower code points. The collator doesn't.
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

// ── Sort by creation date ────────────────────────────────────────────────────

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
	// The unknown doesn't head a list just because it's reversed: documents
	// inherited from the prototype don't carry `createdAt` and would all end
	// up on top.
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

// ── Groups ────────────────────────────────────────────────────────────────────

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
	// Inclusive boundary, same as the range one in `filterEvents`.
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
	// The same rule as `filterEvents`: only the one with neither date is
	// exempt from the range. With one, it's enough to place it in time.
	expect(groupOf(event({ startDate: day("2026-07-01") }), NOW)).toBe(
		"upcoming",
	);
	expect(groupOf(event({ endDate: day("2026-07-01") }), NOW)).toBe("upcoming");
	expect(groupOf(event({ endDate: day("2026-05-01") }), NOW)).toBe("past");
});

test("sin fin declarado, un evento que ya empezó sigue en curso", () => {
	// A review found this by putting the three views side by side, and it was
	// a product contradiction: the monthly grid paints these roadworks on
	// today's cell —`eventSpan` considers them open-ended going forward—
	// while here they fell into "past" the day after they started. The same
	// event, ongoing on the calendar and archived on the agenda.
	//
	// The calendar rules; that's the semantics chosen in T20.
	const obras = event({
		title: "Obras en la calle",
		startDate: day("2026-06-10"),
	});

	expect(groupOf(obras, NOW)).toBe("upcoming");
	// And it's not that "everything that started" stays ongoing: with a
	// declared end that's past, it's past.
	expect(
		groupOf(
			event({ startDate: day("2026-06-10"), endDate: day("2026-06-12") }),
			NOW,
		),
	).toBe("past");
});

test("con el fin antes del inicio manda el inicio", () => {
	// Inconsistent data that the schema now rejects, but that could have been
	// saved before it did. With `endDate` ruling, this event appeared **inside
	// the past fold under a future day's heading**, which is a screen that
	// contradicts itself. `eventSpan` collapses to the start; here, likewise.
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
		// With a declared end: since `groupOf` respects the calendar's
		// semantics, an event with only a start never has a finish, so
		// "past" has to be said by giving when it ended.
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

// ── Preference ────────────────────────────────────────────────────────────────

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
	// `title:desc` is a legitimate `SortPreference` and `sortEvents` knows how
	// to sort by it, but there's no option to render it: accepting it from
	// `localStorage` would leave the selector with a blank label.
	expect(parseSortPreference("title:desc")).toEqual(DEFAULT_SORT);
	expect(parseSortPreference("createdAt:asc")).toEqual(DEFAULT_SORT);
});

test("el objeto devuelto no es el propio DEFAULT_SORT", () => {
	// The return type is mutable, so returning the shared constant would leave
	// the caller changing it through the alias. `as const` protects the
	// direct reference, not one laundered through a mutable return.
	expect(parseSortPreference("basura")).not.toBe(DEFAULT_SORT);
	expect(parseSortPreference("title:asc")).not.toBe(OFFERED_SORTS[2]);
});

// ── The wire format and what the selector offers ────────────────────────────

test("las cadenas guardadas son exactamente éstas", () => {
	// Persisted format: changing it silently discards the preference of
	// everyone who already had one. A literal assertion, not just a
	// round-trip one, which stays invariant under a separator change made on
	// both sides at once.
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
	// Otherwise, the first launch would leave the control with no option
	// marked.
	expect(OFFERED_SORTS.map(serializeSortPreference)).toContain(
		serializeSortPreference(DEFAULT_SORT),
	);
});

// ── Opening the past group ──────────────────────────────────────────────────

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
	// Otherwise the page ends up with a closed accordion strip and zero
	// cards, without even reaching the empty-list message.
	expect(shouldRevealPast(disclosure({ past: 3 }))).toBe(true);
});

test("abierto si el usuario ha buscado o ha filtrado por fechas", () => {
	// Three already-finished events that match the search can't be left
	// hidden: answering an explicit question with a closed drawer is not
	// answering it.
	expect(
		shouldRevealPast(disclosure({ upcoming: 2, past: 3, narrowed: true })),
	).toBe(true);
});

test("buscar no abre un pliegue que no tiene nada dentro", () => {
	expect(
		shouldRevealPast(disclosure({ upcoming: 2, past: 0, narrowed: true })),
	).toBe(false);
});
