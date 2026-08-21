import { afterEach, expect, test, vi } from "vitest";
import type { CalendarEvent } from "../domain/build-ics.js";
import "./calendar-export.js";
import type { PlanuCalendarExport } from "./calendar-export.js";

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: "abc123",
	title: "Feria del libro",
	startDate: new Date(2026, 5, 12),
	...extra,
});

async function mount(
	events: CalendarEvent[],
	mode: "event" | "agenda" = "event",
): Promise<PlanuCalendarExport> {
	const el = document.createElement(
		"planu-calendar-export",
	) as PlanuCalendarExport;
	el.events = events;
	el.mode = mode;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

/** What `wa-dropdown` emits when an option is chosen. */
async function select(el: PlanuCalendarExport, value: string): Promise<void> {
	el.shadowRoot
		?.querySelector("wa-dropdown")
		?.dispatchEvent(
			new CustomEvent("wa-select", { detail: { item: { value } } }),
		);
	await el.updateComplete;
}

/**
 * Intercepts the download.
 *
 * The file never actually leaves the browser —that's what the e2e checks—;
 * what matters here is what content and what name get handed to the
 * link.
 */
function interceptDownload() {
	const capturado: { blob?: Blob; name?: string } = {};
	vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		capturado.blob = blob as Blob;
		return "blob:planu-test";
	});
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		capturado.name = this.download;
	});
	return capturado;
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Happy path ──────────────────────────────────────────────────────────────

test("descarga el evento como .ics con su nombre y su contenido", async () => {
	const descarga = interceptDownload();
	const el = await mount([event()]);

	await select(el, "ics");

	expect(descarga.name).toBe("feria-del-libro.ics");
	expect(descarga.blob?.type).toBe("text/calendar;charset=utf-8");
	const texto = (await descarga.blob?.text()) ?? "";
	expect(texto).toContain("BEGIN:VEVENT");
	expect(texto).toContain("UID:abc123@planu.app");
	expect(texto).toContain("SUMMARY:Feria del libro");
	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

	el.remove();
});

test("la agenda sale en un solo fichero con todos sus eventos", async () => {
	const descarga = interceptDownload();
	const el = await mount([
		event(),
		event({ id: "def456", title: "Concierto" }),
	]);

	await select(el, "ics");

	expect(descarga.name).toBe("planu-agenda.ics");
	const texto = (await descarga.blob?.text()) ?? "";
	expect(texto.match(/BEGIN:VEVENT/g)).toHaveLength(2);
	expect(texto.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);

	el.remove();
});

test("abre Google Calendar con el evento en la URL", async () => {
	const open = vi
		.spyOn(window, "open")
		.mockImplementation(() => null as unknown as Window);
	const el = await mount([event()]);

	await select(el, "google");

	const [url, target, features] = open.mock.calls[0] ?? [];
	expect(String(url)).toContain("calendar.google.com");
	expect(String(url)).toContain("dates=20260612%2F20260613");
	expect(target).toBe("_blank");
	// Without this, the Google tab could manipulate ours.
	expect(features).toContain("noopener");
	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

	el.remove();
});

test("exporta lo que puede y dice qué se ha quedado fuera", async () => {
	const descarga = interceptDownload();
	const el = await mount([
		event(),
		event({ id: "def456", startDate: null, endDate: null }),
	]);

	await select(el, "ics");

	const texto = (await descarga.blob?.text()) ?? "";
	expect(texto.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"left out",
	);

	el.remove();
});

// ── Warnings ─────────────────────────────────────────────────────────────────

test("un evento sin fechas avisa en vez de descargar un fichero roto", async () => {
	const descarga = interceptDownload();
	const el = await mount([event({ startDate: null, endDate: null })]);

	await select(el, "ics");

	expect(descarga.blob).toBeUndefined();
	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"no dates",
	);

	el.remove();
});

test("una agenda sin ninguna fecha también avisa", async () => {
	const el = await mount([
		event({ startDate: null }),
		event({ id: "def456", startDate: null }),
	]);

	await select(el, "ics");

	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"nothing to export",
	);

	el.remove();
});

test("sin eventos no dice que les falten fechas: dice que no hay eventos", async () => {
	// This is the case of a search with no results. "None of them have
	// dates" would be a lie and would send the user looking in the wrong
	// place.
	const el = await mount([]);

	await select(el, "ics");

	const aviso = el.shadowRoot?.querySelector("wa-callout")?.textContent ?? "";
	expect(aviso).toContain("no events to export");
	expect(aviso).not.toContain("no dates");

	el.remove();
});

test("sin eventos el desplegable está deshabilitado", async () => {
	const vacio = await mount([]);
	const conEventos = await mount([event()]);

	expect(
		vacio.shadowRoot?.querySelector("wa-button[slot='trigger']"),
	).toHaveProperty("disabled", true);
	expect(
		conEventos.shadowRoot?.querySelector("wa-button[slot='trigger']"),
	).toHaveProperty("disabled", false);

	vacio.remove();
	conEventos.remove();
});

test("sin haber pulsado nada no hay aviso", async () => {
	const el = await mount([event({ startDate: null })]);

	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

	el.remove();
});

test("el enlace a Google Calendar sólo se ofrece con un evento", async () => {
	// Its template supports only one: offering it for the whole agenda
	// would promise something it can't deliver.
	const uno = await mount([event()]);
	const varios = await mount([event(), event({ id: "def456" })]);

	expect(
		uno.shadowRoot?.querySelector('wa-dropdown-item[value="google"]'),
	).not.toBeNull();
	expect(
		varios.shadowRoot?.querySelector('wa-dropdown-item[value="google"]'),
	).toBeNull();

	uno.remove();
	varios.remove();
});

test("un evento sin fechas tampoco abre Google Calendar", async () => {
	const open = vi
		.spyOn(window, "open")
		.mockImplementation(() => null as unknown as Window);
	const el = await mount([event({ startDate: null, endDate: null })]);

	await select(el, "google");

	expect(open).not.toHaveBeenCalled();
	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"no dates",
	);

	el.remove();
});

test("el aviso se retira solo en vez de quedarse tapando la interfaz", async () => {
	vi.useFakeTimers();
	try {
		const el = await mount([event({ startDate: null, endDate: null })]);
		await select(el, "ics");
		expect(el.shadowRoot?.querySelector("wa-callout")).not.toBeNull();

		vi.advanceTimersByTime(8000);
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

test("la agenda no se convierte en un evento suelto al quedar uno visible", async () => {
	// The component lives in two places with two roles. Inferring the role
	// from `events.length === 1` meant a filter that left just one card
	// would turn the agenda toolbar into an event exporter: the label
	// changed, it offered Google Calendar, and the file got named after
	// the event. An e2e uncovered it; this pins it down without spinning
	// up a whole browser.
	const el = await mount([event()], "agenda");
	const trigger = el.shadowRoot?.querySelector("wa-button");

	expect(trigger?.textContent?.trim()).toBe("Export calendar");
	expect(
		el.shadowRoot?.querySelector('wa-dropdown-item[value="google"]'),
	).toBeNull();

	const descarga = interceptDownload();
	await select(el, "ics");
	expect(descarga.name).toBe("planu-agenda.ics");
});

test("una tarjeta sí exporta como evento suelto", async () => {
	// The control for the test above: without it, "Export calendar" could
	// be showing up always and the assertion would pass for the wrong
	// reason.
	const el = await mount([event()], "event");
	const trigger = el.shadowRoot?.querySelector("wa-button");

	expect(trigger?.textContent?.trim()).toBe("Add to calendar");
	expect(
		el.shadowRoot?.querySelector('wa-dropdown-item[value="google"]'),
	).not.toBeNull();
});
