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

/** Lo que emite `wa-dropdown` al elegir una opción. */
async function select(el: PlanuCalendarExport, value: string): Promise<void> {
	el.shadowRoot
		?.querySelector("wa-dropdown")
		?.dispatchEvent(
			new CustomEvent("wa-select", { detail: { item: { value } } }),
		);
	await el.updateComplete;
}

/**
 * Intercepta la descarga.
 *
 * El fichero no llega a salir del navegador —eso lo mira el e2e—; aquí interesa
 * qué contenido y qué nombre se le entregan al enlace.
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

// ── Camino feliz ─────────────────────────────────────────────────────────────

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
	// Sin esto, la pestaña de Google podría manipular la nuestra.
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

// ── Avisos ───────────────────────────────────────────────────────────────────

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
	// Es el caso de una búsqueda sin resultados. «Ninguno tiene fechas» sería
	// mentira y mandaría al usuario a mirar donde no es.
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
	// Su plantilla admite uno solo: ofrecerlo para la agenda entera prometería
	// algo que no puede cumplir.
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
	// El componente vive en dos sitios con dos papeles. Deducir el papel de
	// `events.length === 1` hacía que un filtro que dejase una sola tarjeta
	// convirtiese la barra de la agenda en un exportador de evento: cambiaba el
	// rótulo, ofrecía Google Calendar y el fichero pasaba a llamarse como el
	// evento. Lo destapó un e2e; esto lo fija sin levantar un navegador entero.
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
	// El control del test de arriba: sin él, «Export calendar» podría estar
	// saliendo siempre y la aserción pasaría por la razón equivocada.
	const el = await mount([event()], "event");
	const trigger = el.shadowRoot?.querySelector("wa-button");

	expect(trigger?.textContent?.trim()).toBe("Add to calendar");
	expect(
		el.shadowRoot?.querySelector('wa-dropdown-item[value="google"]'),
	).not.toBeNull();
});
