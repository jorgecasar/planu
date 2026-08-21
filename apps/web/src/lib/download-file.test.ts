import { afterEach, expect, test, vi } from "vitest";
import { downloadTextFile } from "./download-file.js";

const URL_FALSO = "blob:planu-test";

/**
 * The object URL and the click are intercepted: what's checked is what gets
 * handed to the browser, not that Chromium actually saves a file —that's the
 * e2e's job—.
 */
function spy() {
	const estado: {
		blob?: Blob;
		anchor?: HTMLAnchorElement;
		conectadoAlPulsar?: boolean;
	} = {};

	const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		estado.blob = blob as Blob;
		return URL_FALSO;
	});
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		estado.anchor = this;
		estado.conectadoAlPulsar = this.isConnected;
	});

	return { estado, create, revoke };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("entrega el contenido y el nombre al enlace de descarga", async () => {
	const { estado, create } = spy();

	downloadTextFile("BEGIN:VCALENDAR\r\n", "agenda.ics", "text/calendar");

	expect(create).toHaveBeenCalledTimes(1);
	expect(await estado.blob?.text()).toBe("BEGIN:VCALENDAR\r\n");
	expect(estado.blob?.type).toBe("text/calendar");
	expect(estado.anchor?.download).toBe("agenda.ics");
	expect(estado.anchor?.href).toBe(URL_FALSO);
});

test("el enlace está en el documento al pulsarlo y no se queda después", () => {
	// Some browsers ignore the click() of a detached link; and leaving it in
	// place would fill the body with invisible links.
	const { estado } = spy();

	downloadTextFile("x", "agenda.ics", "text/calendar");

	expect(estado.conectadoAlPulsar).toBe(true);
	expect(estado.anchor?.isConnected).toBe(false);
});

test("no revoca el object URL antes de que la descarga haya podido leerlo", () => {
	vi.useFakeTimers();
	const { revoke } = spy();

	downloadTextFile("x", "agenda.ics", "text/calendar");

	// Revoking within the same tick cancels the download in some browsers.
	expect(revoke).not.toHaveBeenCalled();
	vi.advanceTimersByTime(999);
	expect(revoke).not.toHaveBeenCalled();

	vi.advanceTimersByTime(1);
	// And revoking late or never leaves the Blob retained in memory.
	expect(revoke).toHaveBeenCalledWith(URL_FALSO);
});
