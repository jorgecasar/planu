import { expect, test } from "vitest";
import {
	fileToBase64,
	type GenerateContent,
	GenerationError,
	generateEventFromImage,
	parseGeneratedEvent,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";

const image = () =>
	new File([new Uint8Array([1, 2, 3])], "cartel.png", { type: "image/png" });

test("interpreta una respuesta completa", () => {
	const result = parseGeneratedEvent(
		JSON.stringify({
			title: "Feria del libro",
			description: "Puestos y firmas",
			location: "Parque del Retiro",
			startDate: "2026-06-01T10:00:00Z",
			endDate: "2026-06-15T20:00:00Z",
		}),
	);

	expect(result.title).toBe("Feria del libro");
	expect(result.startDate?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
	expect(result.endDate?.toISOString()).toBe("2026-06-15T20:00:00.000Z");
});

test("las fechas vacías o inválidas quedan en null y no rompen", () => {
	// Gemini Nano is small and frequently returns garbage in this field.
	const result = parseGeneratedEvent(
		JSON.stringify({
			title: "Concierto",
			startDate: "",
			endDate: "el próximo jueves",
		}),
	);

	expect(result.startDate).toBeNull();
	expect(result.endDate).toBeNull();
});

test("una fecha de sólo día se queda en ese día, no en el anterior", () => {
	// `new Date("2026-06-20")` is midnight UTC: west of Greenwich — and the
	// suite runs in America/Santiago — that is the 19th.
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "Feria", startDate: "2026-06-20" }),
	);

	expect(result.startDate?.getFullYear()).toBe(2026);
	expect(result.startDate?.getMonth()).toBe(5);
	expect(result.startDate?.getDate()).toBe(20);
});

test("una fecha con hora se respeta tal cual", () => {
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "Cena", startDate: "2026-06-20T21:00" }),
	);

	expect(result.startDate?.getDate()).toBe(20);
	expect(result.startDate?.getHours()).toBe(21);
});

// ── allDay: the hour the AI already extracted and the editor was losing ─────

test("una fecha con hora pone allDay en false", () => {
	// Without this, the editor showed empty time fields even when `startDate`
	// carried a real hour — decision 4 of the spec: it's the flag, not the
	// data itself, that decides whether they're shown — so the AI's
	// extraction lost it the instant it had gotten it.
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "Cena", startDate: "2026-06-20T21:00" }),
	);

	expect(result.allDay).toBe(false);
});

test("una fecha de sólo día deja allDay en true", () => {
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "Feria", startDate: "2026-06-20" }),
	);

	expect(result.allDay).toBe(true);
});

test("sin ninguna fecha, allDay se queda en true", () => {
	const result = parseGeneratedEvent(JSON.stringify({ title: "Concierto" }));

	expect(result.allDay).toBe(true);
});

test("con inicio de sólo día y fin con hora, basta que uno de los dos la tenga", () => {
	// Not common, but the model isn't always consistent between the two
	// fields: if either one carries an hour, the event is timed.
	const result = parseGeneratedEvent(
		JSON.stringify({
			title: "Congreso",
			startDate: "2026-06-20",
			endDate: "2026-06-22T18:00",
		}),
	);

	expect(result.allDay).toBe(false);
});

test("una fecha de sólo día a medianoche no se confunde con una cita a medianoche", () => {
	// The reason allDay is computed at parse time instead of guessed
	// afterward from the resulting Date's own components: a date-only ISO
	// string and one with an explicit 00:00 time produce the same local
	// instant, but mean different things.
	const soloDia = parseGeneratedEvent(
		JSON.stringify({ title: "Feria", startDate: "2026-06-20" }),
	);
	const conHoraCero = parseGeneratedEvent(
		JSON.stringify({
			title: "Entrega a medianoche",
			startDate: "2026-06-20T00:00",
		}),
	);

	expect(soloDia.allDay).toBe(true);
	expect(conHoraCero.allDay).toBe(false);
});

test("lo que no es ISO se descarta en vez de adivinarse", () => {
	// What matters is not that they are null, but **why**: `new Date("June 20")`
	// returns the year 2001, and a date like that gets saved with a mistake
	// nobody notices. Empty is better than wrong.
	for (const raw of ["June 20", "20 de junio", "20/06/2026", "20-06-2026"]) {
		const result = parseGeneratedEvent(
			JSON.stringify({ title: "x", startDate: raw }),
		);
		expect(result.startDate, raw).toBeNull();
	}
});

test("un día que no existe no desborda al mes siguiente", () => {
	// `new Date(2026, 5, 32)` is 2 July, with no warning.
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "x", startDate: "2026-06-32" }),
	);

	expect(result.startDate).toBeNull();
});

test("los campos de texto ausentes quedan vacíos, no undefined", () => {
	const result = parseGeneratedEvent(JSON.stringify({ title: "Concierto" }));

	expect(result.description).toBe("");
	expect(result.location).toBe("");
});

test("una respuesta que no es JSON se rechaza con un error propio", () => {
	expect(() => parseGeneratedEvent("Claro, aquí tienes:")).toThrow(
		GenerationError,
	);
});

test("una respuesta sin título se rechaza", () => {
	// With no title there is no event to save: the schema requires it.
	expect(() =>
		parseGeneratedEvent(JSON.stringify({ description: "x" })),
	).toThrow(GenerationError);
	expect(() => parseGeneratedEvent(JSON.stringify({ title: "   " }))).toThrow(
		GenerationError,
	);
});

test("un JSON que no es objeto se rechaza", () => {
	expect(() => parseGeneratedEvent("[1,2,3]")).toThrow(GenerationError);
	expect(() => parseGeneratedEvent("42")).toThrow(GenerationError);
});

test("codifica la imagen en base64", async () => {
	// Bytes 0x01 0x02 0x03 are "AQID": comparing against btoa("") would let
	// the test pass even if the function returned an empty string.
	expect(await fileToBase64(image())).toBe("AQID");
});

test("envía el prompt y la imagen en línea", async () => {
	let enviado: unknown[] = [];
	const generate: GenerateContent = async (parts) => {
		enviado = parts;
		return JSON.stringify({ title: "Feria" });
	};

	const result = await generateEventFromImage(
		generate,
		image(),
		new Date(2026, 7, 17),
	);

	expect(result.title).toBe("Feria");
	expect(enviado).toHaveLength(2);
	expect(enviado[0]).toMatchObject({
		text: expect.stringContaining("event planner"),
	});
	// The image has the same date problem as pasted text: without knowing
	// what day it is today, a poster that says "20 June" has no year.
	expect(enviado[0]).toMatchObject({
		text: expect.stringContaining("2026-08-17"),
	});
	expect(enviado[1]).toMatchObject({
		inlineData: { mimeType: "image/png", data: "AQID" },
	});
});

test("propaga el fallo del modelo en vez de tragárselo", async () => {
	const generate: GenerateContent = async () => {
		throw new Error("network");
	};

	await expect(generateEventFromImage(generate, image())).rejects.toThrow(
		"network",
	);
});

test("acepta JSON envuelto en un bloque de código", () => {
	// Small models add it even when the output is constrained.
	const conValla = '```json\n{"title":"Feria del libro"}\n```';
	expect(parseGeneratedEvent(conValla).title).toBe("Feria del libro");

	const sinEtiqueta = '```\n{"title":"Concierto"}\n```';
	expect(parseGeneratedEvent(sinEtiqueta).title).toBe("Concierto");
});

test("el esquema para la IA del navegador exige los campos con contenido", () => {
	expect(RESPONSE_JSON_SCHEMA.required).toContain("title");
	expect(Object.keys(RESPONSE_JSON_SCHEMA.properties)).toEqual([
		"title",
		"description",
		"location",
		"startDate",
		"endDate",
	]);
});

test("un año de dos cifras es ese año, no el del siglo XX", () => {
	// `new Date(26, 5, 20)` is 1926, and the overflow check considers it
	// valid because the month and day match.
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "x", startDate: "0026-06-20" }),
	);

	expect(result.startDate?.getFullYear()).toBe(26);
});

test("el modelo no puede colar campos que no se le han pedido", () => {
	// What keeps prompt injection from scaling: the object is
	// **rebuilt** with six keys, not filtered. If someone swapped this for
	// a spread, `imageUrl` would be a beacon and `memberIds` a self-invite.
	const result = parseGeneratedEvent(
		JSON.stringify({
			title: "Cena",
			imageUrl: "https://evil.example/beacon.png",
			userId: "otro",
			memberIds: ["otro"],
			tags: ["colada"],
		}),
	) as unknown as Record<string, unknown>;

	expect(Object.keys(result).sort()).toEqual([
		"allDay",
		"description",
		"endDate",
		"location",
		"startDate",
		"title",
	]);
});
