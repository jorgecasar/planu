import { afterEach, expect, test, vi } from "vitest";
import { downloadTextFile } from "./download-file.js";

const URL_FALSO = "blob:planu-test";

/**
 * Se intercepta el object URL y el clic: lo que se comprueba es qué se le
 * entrega al navegador, no que Chromium guarde un fichero —eso es el e2e—.
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
	// Hay navegadores que ignoran el click() de un enlace suelto; y dejarlo
	// puesto llenaría el body de enlaces invisibles.
	const { estado } = spy();

	downloadTextFile("x", "agenda.ics", "text/calendar");

	expect(estado.conectadoAlPulsar).toBe(true);
	expect(estado.anchor?.isConnected).toBe(false);
});

test("no revoca el object URL antes de que la descarga haya podido leerlo", () => {
	vi.useFakeTimers();
	const { revoke } = spy();

	downloadTextFile("x", "agenda.ics", "text/calendar");

	// Revocar en el mismo turno cancela la descarga en algunos navegadores.
	expect(revoke).not.toHaveBeenCalled();
	vi.advanceTimersByTime(999);
	expect(revoke).not.toHaveBeenCalled();

	vi.advanceTimersByTime(1);
	// Y revocar tarde o nunca deja el Blob retenido en memoria.
	expect(revoke).toHaveBeenCalledWith(URL_FALSO);
});
