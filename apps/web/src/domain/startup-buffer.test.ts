import { afterEach, describe, expect, test, vi } from "vitest";
import {
	captureStartupErrors,
	flushStartupErrors,
	resetStartupBuffer,
} from "./startup-buffer.js";

/** A Sentry double that only needs to know how to capture. */
function fakeSentry() {
	return { captureException: vi.fn() };
}

/**
 * Errors arrive via event rather than actually being thrown:
 * `dispatchEvent` keeps the test deterministic and doesn't clutter the
 * browser console.
 */
function emitError(message: string): void {
	globalThis.dispatchEvent(
		new ErrorEvent("error", { message, error: new Error(message) }),
	);
}

function emitRejection(reason: unknown): void {
	// Built by hand instead of with `Promise.reject`: this way the test
	// doesn't depend on when the browser decides a rejection went unhandled.
	const event = new Event("unhandledrejection") as Event & { reason?: unknown };
	event.reason = reason;
	globalThis.dispatchEvent(event);
}

/**
 * An `error` event with neither `error` nor `message`, to check that
 * **nobody** is listening. With a full `ErrorEvent`, Vitest's unhandled-error
 * detector would pick it up and fail the test for an unrelated reason.
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
