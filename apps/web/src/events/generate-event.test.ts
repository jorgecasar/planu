import { expect, test } from "vitest";
import {
	type GenerateContent,
	fileToBase64,
	generateEventFromImage,
	GenerationError,
	parseGeneratedEvent,
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

test("los campos de texto ausentes quedan vacíos, no undefined", () => {
	const result = parseGeneratedEvent(JSON.stringify({ title: "Concierto" }));

	expect(result.description).toBe("");
	expect(result.location).toBe("");
});

test("una respuesta que no es JSON se rechaza con un error propio", () => {
	expect(() => parseGeneratedEvent("Claro, aquí tienes:")).toThrow(GenerationError);
});

test("una respuesta sin título se rechaza", () => {
	// Sin título no hay evento que guardar: el esquema lo exige.
	expect(() => parseGeneratedEvent(JSON.stringify({ description: "x" }))).toThrow(
		GenerationError,
	);
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

	const result = await generateEventFromImage(generate, image());

	expect(result.title).toBe("Feria");
	expect(enviado).toHaveLength(2);
	expect(enviado[0]).toMatchObject({ text: expect.stringContaining("event planner") });
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
