import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "../styles/theme-planu.css";
import "../styles/fonts.css";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { initLocale } from "../i18n/localization.js";
import "./events-view.js";
import { widestLabel } from "./events-view.js";

// index.html puts the theme class on <html>; the test page has none.
document.documentElement.classList.add("wa-theme-planu", "wa-light");

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

test("«Nuevo evento» is fixed to the bottom only inside the phone media query", () => {
	const button = el.shadowRoot?.querySelector("wa-button.new");
	expect(button?.textContent?.trim()).toBe("Nuevo evento");
	const media = [...(el.shadowRoot?.adoptedStyleSheets ?? [])]
		.flatMap((sheet) => [...sheet.cssRules])
		.filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule);
	const phone = media.find((rule) => rule.conditionText.includes("40rem"));
	const rule = [...(phone?.cssRules ?? [])].find(
		(inner) => (inner as CSSStyleRule).selectorText === ".new",
	) as CSSStyleRule | undefined;
	expect(rule?.style.position).toBe("fixed");
});

// Chrome flags a field with no name or no autocomplete hint.
test("the sort select carries a name", () => {
	const select = el.shadowRoot?.querySelector("wa-select");
	expect(select?.getAttribute("name")).toBe("sort");
});

type AiProbe = HTMLElement & {
	aiAvailable: boolean;
	updateComplete: Promise<unknown>;
	connectedCallback(): unknown;
};

async function mountWithLanguageModel(
	availability: () => Promise<string>,
): Promise<AiProbe> {
	Object.defineProperty(globalThis, "LanguageModel", {
		value: { availability },
		configurable: true,
		writable: true,
	});
	const probe = document.createElement(
		"planu-events-view",
	) as unknown as AiProbe;
	document.body.append(probe);
	await probe.updateComplete;
	return probe;
}

test("connectedCallback is synchronous and returns no promise", () => {
	const probe = document.createElement(
		"planu-events-view",
	) as unknown as AiProbe;
	expect(probe.connectedCallback()).toBeUndefined();
});

test("aiAvailable turns true once the check resolves available", async () => {
	const probe = await mountWithLanguageModel(async () => "available");
	await vi.waitFor(() => expect(probe.aiAvailable).toBe(true));
	probe.remove();
});

test("aiAvailable stays false while pending and when unavailable", async () => {
	let release: (value: string) => void = () => undefined;
	const pending = new Promise<string>((resolve) => {
		release = resolve;
	});
	const probe = await mountWithLanguageModel(() => pending);
	expect(probe.aiAvailable).toBe(false);
	release("unavailable");
	await pending;
	await probe.updateComplete;
	expect(probe.aiAvailable).toBe(false);
	probe.remove();
});

test("aiAvailable is not written once the element is disconnected", async () => {
	let release: (value: string) => void = () => undefined;
	const pending = new Promise<string>((resolve) => {
		release = resolve;
	});
	const probe = await mountWithLanguageModel(() => pending);
	probe.remove();
	release("available");
	await pending;
	await vi.waitFor(() => expect(probe.aiAvailable).toBe(false));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(probe.aiAvailable).toBe(false);
});
