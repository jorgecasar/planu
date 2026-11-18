import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "../styles/theme-planu.css";
import "../styles/fonts.css";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sortOptions } from "../../domain/sort-events.js";
import { initLocale } from "../../i18n/localization.js";
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

// ── What the list shows, and what the toolbar and the editor do ──────────────

type ViewProbe = HTMLElement & {
	updateComplete: Promise<unknown>;
	eventsSnapshot: unknown;
	user: unknown;
	editorOpen: boolean;
	editing: unknown;
	draft: unknown;
	draftIsSample: boolean;
};

const stored = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	title: `Evento ${id}`,
	description: "",
	location: "",
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

async function mountView(
	status: "loading" | "ready" | "error" | undefined,
	events: ReturnType<typeof stored>[] = [],
): Promise<ViewProbe> {
	const view = document.createElement(
		"planu-events-view",
	) as unknown as ViewProbe;
	view.eventsSnapshot = status ? { status, events } : undefined;
	view.user = { uid: "u1" };
	document.body.append(view);
	await view.updateComplete;
	return view;
}

/** What `planu-event-filters` reports when the person narrows the list. */
async function filter(
	view: ViewProbe,
	change: { searchTerm?: string; ownership?: string; tags?: string[] },
): Promise<void> {
	view.shadowRoot?.querySelector("planu-event-filters")?.dispatchEvent(
		new CustomEvent("planu-filters-change", {
			detail: { searchTerm: "", ownership: "all", tags: [], ...change },
		}),
	);
	await view.updateComplete;
}

/**
 * Removes the view once the editor's dialog has finished updating: a dialog
 * asked to open and detached in the same turn rejects `showModal()` with
 * nobody listening, and Vitest reports it as an unhandled error.
 */
async function dispose(view: ViewProbe): Promise<void> {
	const editor = view.shadowRoot?.querySelector("planu-event-editor") as
		| (HTMLElement & { updateComplete: Promise<unknown> })
		| null;
	await editor?.updateComplete;
	const dialog = editor?.shadowRoot?.querySelector("wa-dialog") as
		| (HTMLElement & { updateComplete: Promise<unknown> })
		| null
		| undefined;
	await dialog?.updateComplete;
	view.remove();
}

const emptyMessage = (view: ViewProbe) =>
	view.shadowRoot?.querySelector(".empty p")?.textContent?.trim();

test("sin conexión con los datos, la vista avisa con una alerta", async () => {
	const view = await mountView("error");
	const alert = view.shadowRoot?.querySelector('wa-callout[role="alert"]');
	expect(alert?.textContent?.trim()).toBe(
		"No se pudieron cargar tus eventos. Revisa la conexión y recarga la página.",
	);
	view.remove();
});

test("mientras cargan los eventos se pintan seis esqueletos, no una lista vacía", async () => {
	for (const status of ["loading", undefined] as const) {
		const view = await mountView(status);
		expect(view.shadowRoot?.querySelectorAll("wa-skeleton")).toHaveLength(6);
		expect(view.shadowRoot?.querySelector(".empty")).toBeNull();
		view.remove();
	}
});

test("cada filtro que vacía la lista dice su propio motivo", async () => {
	const view = await mountView("ready", [stored("a")]);

	await filter(view, { ownership: "shared" });
	expect(emptyMessage(view)).toBe(
		"Todavía nadie ha compartido un evento contigo.",
	);

	await filter(view, { ownership: "mine", searchTerm: "zzz" });
	expect(emptyMessage(view)).toBe(
		"Ningún evento coincide con la búsqueda, las etiquetas o el filtro de fechas.",
	);

	view.eventsSnapshot = {
		status: "ready",
		events: [stored("b", { userId: "u2", memberIds: ["u1", "u2"] })],
	};
	await filter(view, { ownership: "mine" });
	expect(emptyMessage(view)).toBe("Todavía no has creado ningún evento.");
	view.remove();
});

test("sin ningún evento se ofrece crear uno, y «probar un ejemplo» abre el editor con él", async () => {
	const view = await mountView("ready");
	const empty = view.shadowRoot?.querySelector("planu-empty-state");
	expect(empty).not.toBeNull();
	expect(view.editorOpen).toBe(false);

	empty?.dispatchEvent(new CustomEvent("planu-try-sample"));
	await view.updateComplete;
	expect(view.editorOpen).toBe(true);
	expect(view.draftIsSample).toBe(true);
	expect(view.draft).toBeDefined();
	await dispose(view);
});

test("«Nuevo evento» abre el editor vacío y borra el borrador de antes", async () => {
	const view = await mountView("ready");
	view.shadowRoot
		?.querySelector("planu-empty-state")
		?.dispatchEvent(new CustomEvent("planu-try-sample"));
	await view.updateComplete;
	expect(view.draftIsSample).toBe(true);

	view.shadowRoot?.querySelector<HTMLElement>("wa-button.new")?.click();
	await view.updateComplete;

	expect(view.editorOpen).toBe(true);
	expect(view.draft).toBeUndefined();
	expect(view.draftIsSample).toBe(false);
	expect(view.editing).toBeUndefined();
	await dispose(view);
});

test("editar desde una tarjeta o elegir un evento sin fecha abre el editor con ese evento", async () => {
	const event = stored("a");
	for (const type of ["planu-edit-event", "planu-event-picked"]) {
		const view = await mountView("ready", [event]);
		view.dispatchEvent(new CustomEvent(type, { detail: event }));
		await view.updateComplete;
		expect(view.editorOpen).toBe(true);
		expect(view.editing).toBe(event);
		await dispose(view);
	}
});

test("cerrar el editor deja de editar", async () => {
	const event = stored("a");
	const view = await mountView("ready", [event]);
	view.dispatchEvent(new CustomEvent("planu-edit-event", { detail: event }));
	await view.updateComplete;

	view.shadowRoot
		?.querySelector("planu-event-editor")
		?.dispatchEvent(new CustomEvent("planu-editor-close"));
	await view.updateComplete;

	expect(view.editorOpen).toBe(false);
	expect(view.editing).toBeUndefined();
	await dispose(view);
});

test("cambiar la vista pinta el calendario o la agenda y la recuerda", async () => {
	localStorage.removeItem("planu.events.view");
	const view = await mountView("ready", [stored("a")]);
	const group = view.shadowRoot?.querySelector(
		"wa-radio-group",
	) as HTMLElement & { value: string };
	const choose = async (value: string) => {
		group.value = value;
		group.dispatchEvent(new Event("change"));
		await view.updateComplete;
	};

	expect(view.shadowRoot?.querySelector("planu-event-groups")).not.toBeNull();

	await choose("calendar");
	expect(view.shadowRoot?.querySelector("planu-calendar-view")).not.toBeNull();
	expect(localStorage.getItem("planu.events.view")).toBe("calendar");

	await choose("agenda");
	expect(view.shadowRoot?.querySelector("planu-agenda-view")).not.toBeNull();
	expect(localStorage.getItem("planu.events.view")).toBe("agenda");

	// A value nobody offers falls back to the default instead of breaking.
	await choose("nonsense");
	expect(view.shadowRoot?.querySelector("planu-event-groups")).not.toBeNull();
	view.remove();
	localStorage.removeItem("planu.events.view");
});

test("cambiar el orden lo guarda, y repetir el mismo no escribe", async () => {
	localStorage.removeItem("planu.events.sort");
	const view = await mountView("ready", [stored("a")]);
	const select = view.shadowRoot?.querySelector("wa-select") as HTMLElement & {
		value: string;
	};
	const other = sortOptions().find((option) => option.value !== select.value);
	expect(other).toBeDefined();

	select.value = other?.value ?? "";
	select.dispatchEvent(new Event("change"));
	await view.updateComplete;
	expect(localStorage.getItem("planu.events.sort")).toBe(other?.value);

	localStorage.removeItem("planu.events.sort");
	select.dispatchEvent(new Event("change"));
	await view.updateComplete;
	expect(localStorage.getItem("planu.events.sort")).toBeNull();
	view.remove();
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
