import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "../styles/theme.css";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { initLocale } from "../i18n/localization.js";
import "./events-view.js";
import { widestLabel } from "./events-view.js";

/**
 * The toolbar in Spanish, where the labels are longest: "Fecha, lo más
 * próximo primero" is what used to be cut inside the sort select.
 */
let el: HTMLElement;

beforeAll(async () => {
	vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES"]);
	expect(await initLocale()).toBe("es");
	el = document.createElement("planu-events-view");
	document.body.append(el);
	await (el as HTMLElement & { updateComplete: Promise<unknown> })
		.updateComplete;
});

afterAll(() => {
	el.remove();
	vi.restoreAllMocks();
});

test("widestLabel cuenta los caracteres de la opción más larga", () => {
	expect(widestLabel([{ label: "ab" }, { label: "abcd" }])).toBe(4);
	expect(widestLabel([])).toBe(0);
});

test("el selector de orden no corta su propio valor", async () => {
	const select = el.shadowRoot?.querySelector("wa-select") as HTMLElement & {
		updateComplete: Promise<unknown>;
	};
	await select.updateComplete;
	const input = select.shadowRoot?.querySelector(
		"input.display-input",
	) as HTMLInputElement;
	await vi.waitFor(() =>
		expect(input.value).toBe("Fecha, lo más próximo primero"),
	);
	expect(input.scrollWidth).toBeLessThanOrEqual(input.clientWidth);
});

test("«Exportar el calendario» tiene borde, no parece deshabilitado", () => {
	const exporter = el.shadowRoot?.querySelector("planu-calendar-export");
	expect(exporter?.getAttribute("appearance")).toBe("outlined");
});

// Chrome flags a field with no name or no autocomplete hint.
test("the sort select carries a name", () => {
	const select = el.shadowRoot?.querySelector("wa-select");
	expect(select?.getAttribute("name")).toBe("sort");
});
