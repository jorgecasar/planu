import { expect, test } from "vitest";
import { progressHint, progressMessage } from "./ai-progress.js";

const state = (over: Partial<Parameters<typeof progressMessage>[0]> = {}) => ({
	preparing: false,
	downloading: false,
	uploading: false,
	on: "image" as const,
	...over,
});

test("leyendo un texto no dice que esté leyendo una imagen", () => {
	// The actual bug: the notice lived inside the image block and announced
	// a photo while it was reading what the user had just pasted.
	const message = progressMessage(state({ on: "text" }));

	expect(message).not.toMatch(/image/i);
	expect(message).toMatch(/text/i);
});

test("leyendo una imagen lo dice", () => {
	expect(progressMessage(state({ on: "image" }))).toMatch(/image/i);
});

test("las fases se anuncian en el orden en que ocurren", () => {
	// Preparing, downloading, reading and saving are four different waits,
	// and a single "loading…" for all four gives no way to tell if something's
	// wrong.
	expect(progressMessage(state({ preparing: true }))).toMatch(/ready/i);
	expect(progressMessage(state({ uploading: true }))).toMatch(/saving/i);
	expect(progressMessage(state({ on: "text" }))).toMatch(/pulling out/i);
});

test("la descarga del modelo manda sobre lo demás", () => {
	// It can take minutes: staying silent about it and saying "reading"
	// would make it look like it has frozen.
	expect(progressMessage(state({ downloading: true, on: "text" }))).toMatch(
		/download/i,
	);
	expect(
		progressMessage(state({ downloading: true, preparing: true })),
	).toMatch(/download/i);
	expect(
		progressMessage(state({ downloading: true, uploading: true })),
	).toMatch(/download/i);
});

const hint = (over: Partial<Parameters<typeof progressHint>[0]> = {}) =>
	progressHint({
		downloading: false,
		uploading: false,
		onDevice: true,
		...over,
	});

test("la segunda línea explica por qué merece la pena esperar", () => {
	expect(hint()).toMatch(/your device/i);
	expect(hint({ downloading: true })).toMatch(/once/i);
});

test("no promete privacidad si la generación puede irse a la nube", () => {
	// Today the lock in ai-policy keeps everything on the device, but the
	// notice is derived from the actual mode: the day the cloud opens up, it
	// would stop lying on its own.
	expect(hint({ onDevice: false })).not.toMatch(/your device/i);
	expect(hint({ onDevice: false })).toMatch(/seconds/i);
});

test("no promete privacidad mientras sube la portada, que sí sale de aquí", () => {
	// Seen in a screenshot: the notice said "nothing you wrote leaves your
	// device" right while the image was traveling to Storage.
	const subiendo = hint({ uploading: true });

	expect(subiendo).not.toMatch(/nothing/i);
	expect(subiendo).toMatch(/account/i);
});
