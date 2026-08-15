import { expect, test } from "vitest";
import type { PlanuEvent } from "../lib/types.js";
import { filterEvents } from "./filter-events.js";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

const event = (overrides: Partial<PlanuEvent> = {}): PlanuEvent => ({
	title: "Concierto",
	description: "Música en directo",
	location: "Madrid",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: "u1",
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

// ── Rango de fechas ──────────────────────────────────────────────────────────

const range = { from: day("2026-06-10"), to: day("2026-06-20") };

test("un evento sin fechas siempre pasa el filtro de rango", () => {
	// Deliberado: ocultarlos escondería eventos que el usuario quiere ver.
	const events = [event({ startDate: null, endDate: null })];
	expect(filterEvents(events, "", range)).toHaveLength(1);
});

test("evento con inicio y fin: pasa si solapa el rango", () => {
	const dentro = event({ startDate: day("2026-06-12"), endDate: day("2026-06-14") });
	const solapaPorDelante = event({
		startDate: day("2026-06-05"),
		endDate: day("2026-06-11"),
	});
	const fuera = event({ startDate: day("2026-07-01"), endDate: day("2026-07-02") });

	expect(filterEvents([dentro, solapaPorDelante, fuera], "", range)).toHaveLength(2);
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

	expect(filterEvents([justoAlInicio, justoAlFinal], "", range)).toHaveLength(2);
});

test("con un solo extremo, busca lo activo ese día y no lo que empieza", () => {
	const soloDesde = { from: day("2026-06-15") };
	// Empezó antes pero sigue en curso ese día: debe aparecer.
	const enCurso = event({ startDate: day("2026-06-01"), endDate: day("2026-06-30") });
	const yaTerminado = event({
		startDate: day("2026-05-01"),
		endDate: day("2026-05-02"),
	});

	expect(filterEvents([enCurso, yaTerminado], "", soloDesde)).toHaveLength(1);
});

test("texto y fechas se aplican a la vez", () => {
	const events = [
		event({ title: "Concierto", startDate: day("2026-06-12"), endDate: day("2026-06-12") }),
		event({ title: "Concierto", startDate: day("2026-07-12"), endDate: day("2026-07-12") }),
		event({ title: "Cena", startDate: day("2026-06-12"), endDate: day("2026-06-12") }),
	];

	expect(filterEvents(events, "concierto", range)).toHaveLength(1);
});
