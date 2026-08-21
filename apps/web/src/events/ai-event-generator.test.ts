import { expect, test } from "vitest";
import {
	explainFailure,
	progressHint,
	progressMessage,
} from "./ai-event-generator.js";
import { GenerationError } from "./generate-event.js";
import { TextInputError } from "./generate-from-text.js";

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

// --- What gets said when something fails ----------------------------------

const fallo = (over: Partial<Parameters<typeof explainFailure>[0]> = {}) =>
	explainFailure({
		cause: new Error("boom"),
		unreadable: "No event could be found in that text.",
		modelReady: true,
		...over,
	});

test("con el modelo listo, la culpa es del texto y no de la IA", () => {
	// Measured against Gemini Nano: "Remember to buy milk and batteries" makes
	// the model throw an error instead of returning the empty title it's
	// asked for. Without this, that text would announce a failure that
	// doesn't exist.
	expect(fallo()).toMatch(/No event could be found/);
});

test("sin modelo, se dice que la IA no está y que se puede seguir a mano", () => {
	const mensaje = fallo({ modelReady: false });

	expect(mensaje).toMatch(/unavailable/i);
	expect(mensaje).toMatch(/by hand/i);
});

test("un texto ilegible por el modelo se explica igual haya IA o no", () => {
	const causa = new GenerationError("nope");

	expect(fallo({ cause: causa })).toMatch(/No event could be found/);
	expect(fallo({ cause: causa, modelReady: false })).toMatch(
		/No event could be found/,
	);
});

test("lo que falla en la entrada se dice antes de culpar a nadie más", () => {
	expect(fallo({ cause: new TextInputError("too-long") })).toMatch(/too long/i);
	expect(fallo({ cause: new TextInputError("empty") })).toMatch(/Paste/i);
	// And it doesn't depend on whether there's a model: the text is just as
	// long without AI.
	expect(
		fallo({ cause: new TextInputError("too-long"), modelReady: false }),
	).toMatch(/too long/i);
});
