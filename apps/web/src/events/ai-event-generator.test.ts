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
	// El fallo real: el aviso vivía dentro del bloque de la imagen y anunciaba
	// una foto mientras se leía lo que el usuario acababa de pegar.
	const message = progressMessage(state({ on: "text" }));

	expect(message).not.toMatch(/image/i);
	expect(message).toMatch(/text/i);
});

test("leyendo una imagen lo dice", () => {
	expect(progressMessage(state({ on: "image" }))).toMatch(/image/i);
});

test("las fases se anuncian en el orden en que ocurren", () => {
	// Preparar, descargar, leer y guardar son cuatro esperas distintas, y un
	// único «cargando…» para las cuatro no deja saber si algo va mal.
	expect(progressMessage(state({ preparing: true }))).toMatch(/ready/i);
	expect(progressMessage(state({ uploading: true }))).toMatch(/saving/i);
	expect(progressMessage(state({ on: "text" }))).toMatch(/pulling out/i);
});

test("la descarga del modelo manda sobre lo demás", () => {
	// Puede durar minutos: callarla y decir «leyendo» haría parecer que se ha
	// colgado.
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
	// Hoy el candado de ai-policy deja todo en el dispositivo, pero el aviso se
	// deriva del modo real: el día que se abra la nube, dejaría de mentir solo.
	expect(hint({ onDevice: false })).not.toMatch(/your device/i);
	expect(hint({ onDevice: false })).toMatch(/seconds/i);
});

test("no promete privacidad mientras sube la portada, que sí sale de aquí", () => {
	// Se vio en una captura: el aviso decía «nada de lo que escribiste sale de
	// tu dispositivo» justo mientras la imagen viajaba a Storage.
	const subiendo = hint({ uploading: true });

	expect(subiendo).not.toMatch(/nothing/i);
	expect(subiendo).toMatch(/account/i);
});

// --- Qué se dice cuando algo falla ----------------------------------------

const fallo = (over: Partial<Parameters<typeof explainFailure>[0]> = {}) =>
	explainFailure({
		cause: new Error("boom"),
		unreadable: "No event could be found in that text.",
		modelReady: true,
		...over,
	});

test("con el modelo listo, la culpa es del texto y no de la IA", () => {
	// Medido contra Gemini Nano: «Recuerda comprar leche y pilas» hace que el
	// modelo lance un error en vez de devolver el título vacío que se le pide.
	// Sin esto, ese texto anunciaba una avería que no existe.
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
	// Y no depende de que haya modelo: el texto es igual de largo sin IA.
	expect(
		fallo({ cause: new TextInputError("too-long"), modelReady: false }),
	).toMatch(/too long/i);
});
