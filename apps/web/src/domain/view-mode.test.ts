import { expect, test } from "vitest";
import {
	DEFAULT_VIEW,
	OFFERED_VIEWS,
	parseViewMode,
	viewOptions,
} from "./view-mode.js";

test("por defecto se ven las tarjetas", () => {
	// It's the view that existed before the switcher: anyone who never
	// touches it can't find the screen changed.
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
	// Garbage, nothing saved, and the name of a view that doesn't exist: all
	// three arrive from `localStorage`, and none of them can leave the
	// screen without a view.
	expect(parseViewMode("kanban")).toBe(DEFAULT_VIEW);
	expect(parseViewMode(null)).toBe(DEFAULT_VIEW);
	expect(parseViewMode(undefined)).toBe(DEFAULT_VIEW);
	expect(parseViewMode("")).toBe(DEFAULT_VIEW);
	expect(parseViewMode('{"view":"agenda"}')).toBe(DEFAULT_VIEW);
});

test("los valores persistidos son las cadenas literales, no un índice", () => {
	// It's a format saved in the user's browser. Changing it doesn't break
	// anything visible, but it silently discards the preference of whoever
	// already had one, so it has to be a decision and not an oversight.
	expect(viewOptions().map((option) => option.value)).toEqual([
		"grid",
		"calendar",
		"agenda",
	]);
});

test("las etiquetas se traducen al llamar, no al importar el módulo", () => {
	// `msg()` is evaluated when it runs. A list built as a module-level
	// constant would freeze the language at the moment of import, which is
	// before `main.ts` has set the browser's.
	const labels = viewOptions().map((option) => option.label);

	expect(labels).toEqual(["Cards", "Calendar", "Agenda"]);
	expect(labels.every((label) => label.length > 0)).toBe(true);
});

test("cada opción del conmutador lleva su propia etiqueta", () => {
	// With the label derived from the `value` — or shared among all three —
	// the switcher would keep working and would be unreadable.
	expect(new Set(viewOptions().map((option) => option.label)).size).toBe(3);
});
