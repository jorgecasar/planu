import { expect, test } from "vitest";
import {
	DEFAULT_VIEW,
	OFFERED_VIEWS,
	parseViewMode,
	viewOptions,
} from "./view-mode.js";

test("por defecto se ven las tarjetas", () => {
	// Es la vista que existía antes del conmutador: quien no lo toque nunca no
	// puede encontrarse la pantalla cambiada.
	expect(DEFAULT_VIEW).toBe("grid");
});

test("se ofrecen las tres vistas de F5", () => {
	expect(OFFERED_VIEWS).toEqual(["grid", "calendar", "agenda"]);
});

test("cada vista ofrecida se vuelve a leer tal cual", () => {
	for (const mode of OFFERED_VIEWS) {
		expect(parseViewMode(mode)).toBe(mode);
	}
});

test("lo que no es una vista cae a la de por defecto", () => {
	// Basura, nada guardado, y el nombre de una vista que no existe: los tres
	// llegan desde `localStorage`, y ninguno puede dejar la pantalla sin vista.
	expect(parseViewMode("kanban")).toBe(DEFAULT_VIEW);
	expect(parseViewMode(null)).toBe(DEFAULT_VIEW);
	expect(parseViewMode(undefined)).toBe(DEFAULT_VIEW);
	expect(parseViewMode("")).toBe(DEFAULT_VIEW);
	expect(parseViewMode('{"view":"agenda"}')).toBe(DEFAULT_VIEW);
});

test("los valores persistidos son las cadenas literales, no un índice", () => {
	// Es un formato guardado en el navegador del usuario. Cambiarlo no rompe
	// nada visible, pero descarta en silencio la preferencia de quien ya la
	// tenía, así que tiene que ser una decisión y no un descuido.
	expect(viewOptions().map((option) => option.value)).toEqual([
		"grid",
		"calendar",
		"agenda",
	]);
});

test("las etiquetas se traducen al llamar, no al importar el módulo", () => {
	// `msg()` se evalúa cuando se ejecuta. Una lista construida como constante
	// de módulo congelaría el idioma del instante de la importación, que es
	// antes de que `main.ts` haya fijado el del navegador.
	const labels = viewOptions().map((option) => option.label);

	expect(labels).toEqual(["Cards", "Calendar", "Agenda"]);
	expect(labels.every((label) => label.length > 0)).toBe(true);
});

test("cada opción del conmutador lleva su propia etiqueta", () => {
	// Con la etiqueta salida del `value` —o compartida entre las tres— el
	// conmutador seguiría funcionando y sería ilegible.
	expect(new Set(viewOptions().map((option) => option.label)).size).toBe(3);
});
