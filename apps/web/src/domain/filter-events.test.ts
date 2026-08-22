import { expect, test } from "vitest";
import type { PlanuEvent } from "../lib/types.js";
import { filterEvents, isNarrowed } from "./filter-events.js";

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
	...overrides,
});

test("sin criterios devuelve todo", () => {
	const events = [event(), event({ title: "Otro" })];
	expect(filterEvents(events)).toHaveLength(2);
});

test("busca en el título sin distinguir mayúsculas", () => {
	const events = [event({ title: "Concierto" }), event({ title: "Cena" })];
	expect(filterEvents(events, "CONCI")).toHaveLength(1);
});

test("busca también en la descripción", () => {
	const events = [
		event({ title: "A", description: "Música en directo" }),
		event({ title: "B", description: "Cine al aire libre" }),
	];
	expect(filterEvents(events, "directo")).toHaveLength(1);
});

test("los espacios alrededor del término se ignoran", () => {
	expect(filterEvents([event()], "   ")).toHaveLength(1);
	expect(filterEvents([event()], "  concierto  ")).toHaveLength(1);
});

test("una descripción ausente no rompe la búsqueda", () => {
	const events = [event({ description: undefined, title: "Cena" })];
	expect(filterEvents(events, "música")).toHaveLength(0);
	expect(filterEvents(events, "cena")).toHaveLength(1);
});

// ── Date range ───────────────────────────────────────────────────────────────

const range = { from: day("2026-06-10"), to: day("2026-06-20") };

test("un evento sin fechas siempre pasa el filtro de rango", () => {
	// Deliberate: hiding them would hide events the user wants to see.
	const events = [event({ startDate: null, endDate: null })];
	expect(filterEvents(events, "", range)).toHaveLength(1);
});

test("evento con inicio y fin: pasa si solapa el rango", () => {
	const dentro = event({
		startDate: day("2026-06-12"),
		endDate: day("2026-06-14"),
	});
	const solapaPorDelante = event({
		startDate: day("2026-06-05"),
		endDate: day("2026-06-11"),
	});
	const fuera = event({
		startDate: day("2026-07-01"),
		endDate: day("2026-07-02"),
	});

	expect(
		filterEvents([dentro, solapaPorDelante, fuera], "", range),
	).toHaveLength(2);
});

test("evento sólo con inicio: pasa si empieza antes del fin del rango", () => {
	const antes = event({ startDate: day("2026-06-15"), endDate: null });
	const despues = event({ startDate: day("2026-06-25"), endDate: null });

	expect(filterEvents([antes, despues], "", range)).toHaveLength(1);
});

test("evento sólo con fin: pasa si termina después del inicio del rango", () => {
	const despues = event({ startDate: null, endDate: day("2026-06-15") });
	const antes = event({ startDate: null, endDate: day("2026-06-01") });

	expect(filterEvents([despues, antes], "", range)).toHaveLength(1);
});

test("los límites del rango son inclusivos", () => {
	const justoAlInicio = event({
		startDate: day("2026-06-10"),
		endDate: day("2026-06-10"),
	});
	const justoAlFinal = event({
		startDate: day("2026-06-20"),
		endDate: day("2026-06-20"),
	});

	expect(filterEvents([justoAlInicio, justoAlFinal], "", range)).toHaveLength(
		2,
	);
});

test("con un solo extremo, busca lo activo ese día y no lo que empieza", () => {
	const soloDesde = { from: day("2026-06-15") };
	// It started earlier but is still ongoing that day: it must appear.
	const enCurso = event({
		startDate: day("2026-06-01"),
		endDate: day("2026-06-30"),
	});
	const yaTerminado = event({
		startDate: day("2026-05-01"),
		endDate: day("2026-05-02"),
	});

	expect(filterEvents([enCurso, yaTerminado], "", soloDesde)).toHaveLength(1);
});

test("texto y fechas se aplican a la vez", () => {
	const events = [
		event({
			title: "Concierto",
			startDate: day("2026-06-12"),
			endDate: day("2026-06-12"),
		}),
		event({
			title: "Concierto",
			startDate: day("2026-07-12"),
			endDate: day("2026-07-12"),
		}),
		event({
			title: "Cena",
			startDate: day("2026-06-12"),
			endDate: day("2026-06-12"),
		}),
	];

	expect(filterEvents(events, "concierto", range)).toHaveLength(1);
});

// ── Ownership ────────────────────────────────────────────────────────────

const ME = "u1";
const OTHER = "u2";

const mine_ = () => event({ title: "Mine", userId: ME, memberIds: [ME] });
const theirs = () =>
	event({
		title: "Theirs",
		userId: OTHER,
		memberIds: [OTHER, ME],
		roles: { [ME]: "viewer" },
	});

test("«all» does not care whose event it is", () => {
	expect(filterEvents([mine_(), theirs()], "", {}, "all", ME)).toHaveLength(2);
});

test("«mine» leaves out what someone else shared", () => {
	const visible = filterEvents([mine_(), theirs()], "", {}, "mine", ME);
	expect(visible.map((e) => e.title)).toEqual(["Mine"]);
});

test("«shared with me» leaves out your own", () => {
	const visible = filterEvents([mine_(), theirs()], "", {}, "shared", ME);
	expect(visible.map((e) => e.title)).toEqual(["Theirs"]);
});

test("with no session resolved, nothing counts as yours", () => {
	// While the uid is still unknown, treating someone else's event as yours
	// would be worse than the reverse: it would offer actions bound to fail.
	expect(filterEvents([mine_(), theirs()], "", {}, "mine", "")).toHaveLength(0);
	expect(filterEvents([mine_(), theirs()], "", {}, "shared", "")).toHaveLength(
		2,
	);
});

test("ownership adds to text and dates, it does not replace them", () => {
	const events = [
		event({ title: "Concert", userId: ME, memberIds: [ME] }),
		event({ title: "Concert", userId: OTHER, memberIds: [OTHER, ME] }),
		event({ title: "Dinner", userId: ME, memberIds: [ME] }),
	];

	const visible = filterEvents(events, "concert", {}, "mine", ME);
	expect(visible).toHaveLength(1);
	expect(visible[0]?.userId).toBe(ME);
});

// --- tag filtering (F6) ----------------------------------------------------

test("sin etiquetas seleccionadas no filtra por etiqueta", () => {
	const events = [event({ tags: ["cine"] }), event({ tags: [] })];
	expect(filterEvents(events, "", {}, "all", "", [])).toHaveLength(2);
});

test("varias etiquetas se combinan con Y, no con O", () => {
	// With OR this filter would return all three; with AND, only the one that
	// has both. This is the difference that F6 fixes explicitly.
	const events = [
		event({ title: "ambas", tags: ["cine", "teatro"] }),
		event({ title: "sólo cine", tags: ["cine"] }),
		event({ title: "sólo teatro", tags: ["teatro"] }),
	];
	const visible = filterEvents(events, "", {}, "all", "", ["cine", "teatro"]);
	expect(visible.map((e) => e.title)).toEqual(["ambas"]);
});

test("un evento con etiquetas de más sigue encajando", () => {
	const events = [event({ tags: ["cine", "teatro", "verano"] })];
	expect(filterEvents(events, "", {}, "all", "", ["cine"])).toHaveLength(1);
});

test("un evento sin etiquetas no encaja con ninguna", () => {
	// Unlike the date filter, where having no date always passes: asking for a
	// tag means asking for it, and an event with none doesn't have it.
	const events = [event({ tags: [] })];
	expect(filterEvents(events, "", {}, "all", "", ["cine"])).toHaveLength(0);
});

test("la etiqueta se suma al resto de criterios, no los sustituye", () => {
	const events = [
		event({ title: "Concierto", tags: ["cine"] }),
		event({ title: "Cena", tags: ["cine"] }),
	];
	const visible = filterEvents(events, "concierto", {}, "all", "", ["cine"]);
	expect(visible.map((e) => e.title)).toEqual(["Concierto"]);
});

// --- isNarrowed ------------------------------------------------------------

test("sin nada puesto, el usuario sólo está mirando", () => {
	expect(isNarrowed({})).toBe(false);
	expect(isNarrowed({ searchTerm: "", tags: [] })).toBe(false);
});

test("buscar es pedir algo concreto", () => {
	expect(isNarrowed({ searchTerm: "concierto" })).toBe(true);
});

test("filtrar por fechas también", () => {
	expect(isNarrowed({ from: day("2026-06-01") })).toBe(true);
	expect(isNarrowed({ to: day("2026-06-30") })).toBe(true);
});

test("y filtrar por etiqueta también, que es lo que se olvidaba", () => {
	// This is the case the view had duplicated and disagreeing on: clicking the
	// "music" tag and typing "music" are the same intent.
	expect(isNarrowed({ tags: ["música"] })).toBe(true);
});

test("la bandeja elegida no es una consulta", () => {
	// All / mine / shared is a way of navigating, not something you request.
	expect(isNarrowed({ ownership: "shared", uid: "u1" })).toBe(false);
});
