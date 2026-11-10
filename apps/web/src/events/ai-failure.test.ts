import { expect, test } from "vitest";
import { explainFailure } from "./ai-failure.js";
import { GenerationError } from "./generate-event.js";
import { TextInputError } from "./generate-from-text.js";

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
