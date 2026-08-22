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
	// Gemini Nano es pequeño y devuelve basura en este campo con frecuencia.
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
	// `new Date("2026-06-20")` es medianoche UTC: al oeste de Greenwich —y la
	// suite corre en America/Santiago— eso es el 19.
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

// ── allDay: la hora que la IA ya extraía y el editor perdía ─────────────────

test("una fecha con hora pone allDay en false", () => {
	// Sin esto, el editor mostraba los campos de hora vacíos aunque `startDate`
	// llevara una hora real —decisión 4 del spec: es la bandera, no el dato en
	// sí, la que decide si se ven—, así que la extracción de la IA la perdía en
	// el mismo instante en que la había conseguido.
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
	// No es habitual, pero el modelo no siempre es consistente entre los dos
	// campos: si cualquiera trae hora, el evento tiene hora.
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
	// El motivo por el que allDay se calcula en el parseo y no adivinando por
	// los componentes del Date resultante después: una fecha ISO de sólo día y
	// una con hora explícita de 00:00 producen el mismo instante local, pero
	// significan cosas distintas.
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
	// Lo importante no es que sean null, sino **por qué**: `new Date("June 20")`
	// devuelve el año 2001, y una fecha así se guarda con un despiste. Vacío es
	// mejor que equivocado.
	for (const raw of ["June 20", "20 de junio", "20/06/2026", "20-06-2026"]) {
		const result = parseGeneratedEvent(
			JSON.stringify({ title: "x", startDate: raw }),
		);
		expect(result.startDate, raw).toBeNull();
	}
});

test("un día que no existe no desborda al mes siguiente", () => {
	// `new Date(2026, 5, 32)` es el 2 de julio, sin avisar.
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
	// Sin título no hay evento que guardar: el esquema lo exige.
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
	// Los bytes 0x01 0x02 0x03 son "AQID": comparar contra btoa("") dejaría pasar
	// el test aunque la función devolviese cadena vacía.
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
	// La imagen tiene el mismo problema con las fechas que el texto pegado: sin
	// saber qué día es hoy, un cartel que dice «20 de junio» no tiene año.
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
	// Los modelos pequeños lo añaden incluso cuando se les restringe la salida.
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
	// `new Date(26, 5, 20)` es 1926, y la comprobación de desbordamiento lo da
	// por bueno porque mes y día cuadran.
	const result = parseGeneratedEvent(
		JSON.stringify({ title: "x", startDate: "0026-06-20" }),
	);

	expect(result.startDate?.getFullYear()).toBe(26);
});

test("el modelo no puede colar campos que no se le han pedido", () => {
	// Lo que hace que la inyección de prompt no escale: el objeto se
	// **reconstruye** con cinco claves, no se filtra. Si alguien lo cambiara por
	// un spread, `imageUrl` sería una baliza y `memberIds`, una autoinvitación.
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
