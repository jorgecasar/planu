import { afterEach, describe, expect, test, vi } from "vitest";
import {
	captureStartupErrors,
	flushStartupErrors,
	resetStartupBuffer,
} from "./startup-buffer.js";

/** Un doble de Sentry que sólo necesita saber capturar. */
function fakeSentry() {
	return { captureException: vi.fn() };
}

/**
 * Los errores llegan por evento y no lanzando de verdad: `dispatchEvent` deja
 * el test determinista y no ensucia la consola del navegador.
 */
function emitError(message: string): void {
	globalThis.dispatchEvent(
		new ErrorEvent("error", { message, error: new Error(message) }),
	);
}

function emitRejection(reason: unknown): void {
	// Se construye a mano en lugar de con `Promise.reject`: así el test no
	// depende de cuándo decide el navegador que un rechazo quedó sin manejar.
	const event = new Event("unhandledrejection") as Event & { reason?: unknown };
	event.reason = reason;
	globalThis.dispatchEvent(event);
}

/**
 * Un evento `error` sin `error` ni `message`, para comprobar que **nadie**
 * escucha. Con un `ErrorEvent` completo, el detector de errores no manejados
 * de Vitest lo recogería y haría fallar el test por un motivo ajeno.
 */
function emitBareError(): void {
	globalThis.dispatchEvent(new Event("error"));
}

afterEach(() => {
	resetStartupBuffer();
});

describe("buffer de errores de arranque", () => {
	test("reenvía a Sentry lo ocurrido antes de que cargara", () => {
		captureStartupErrors();
		emitError("fallo al arrancar");

		const sentry = fakeSentry();
		flushStartupErrors(sentry);

		expect(sentry.captureException).toHaveBeenCalledTimes(1);
		const [capturado] = sentry.captureException.mock.calls[0] ?? [];
		expect((capturado as Error).message).toBe("fallo al arrancar");
	});

	test("también recoge promesas rechazadas", () => {
		captureStartupErrors();
		emitRejection(new Error("firestore no responde"));

		const sentry = fakeSentry();
		flushStartupErrors(sentry);

		expect(sentry.captureException).toHaveBeenCalledTimes(1);
	});

	test("deja de escuchar tras vaciarse, para no duplicar lo que ya ve el SDK", () => {
		captureStartupErrors();
		const sentry = fakeSentry();
		flushStartupErrors(sentry);

		emitBareError();
		flushStartupErrors(sentry);

		expect(sentry.captureException).not.toHaveBeenCalled();
	});

	test("no acumula sin límite si algo falla en bucle", () => {
		captureStartupErrors();
		for (let i = 0; i < 50; i++) emitError(`fallo ${i}`);

		const sentry = fakeSentry();
		flushStartupErrors(sentry);

		expect(sentry.captureException).toHaveBeenCalledTimes(10);
	});

	test("un fallo al reenviar no tumba la aplicación", () => {
		captureStartupErrors();
		emitError("el original");

		const roto = {
			captureException: vi.fn(() => {
				throw new Error("Sentry roto");
			}),
		};

		expect(() => {
			flushStartupErrors(roto);
		}).not.toThrow();
	});

	test("sin errores previos no llama a Sentry", () => {
		captureStartupErrors();
		const sentry = fakeSentry();
		flushStartupErrors(sentry);
		expect(sentry.captureException).not.toHaveBeenCalled();
	});
});
