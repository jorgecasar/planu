import { expect, test } from "vitest";
import type { GenerateContent } from "./generate-event.js";
import {
	MAX_SUGGESTIONS,
	parseSuggestedTags,
	suggestTagsPrompt,
	suggestTagsWithAi,
} from "./suggest-tags.js";

const answering =
	(answer: string): GenerateContent =>
	async () =>
		answer;

const input = (
	over: Partial<Parameters<typeof suggestTagsPrompt>[0]> = {},
) => ({
	title: "Concierto de verano",
	description: "En el auditorio, con Ana y Marta",
	location: "Auditorio",
	knownTags: ["música", "amigos"],
	chosenTags: [],
	...over,
});

// --- El parseo -------------------------------------------------------------

test("interpreta hasta tres etiquetas propuestas", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["música", "verano", "concierto"] }),
		[],
		[],
	);

	expect(result).toEqual(["música", "verano", "concierto"]);
});

test("las que ya usa el usuario van primero", () => {
	// La prioridad no depende de que el modelo las ordene bien: se reordena
	// aquí de forma determinista, así que es comprobable sin un modelo real.
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["verano", "música", "concierto"] }),
		["música"],
		[],
	);

	expect(result[0]).toBe("música");
});

test("recorta a un máximo de tres aunque el modelo proponga más", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["a", "b", "c", "d", "e"] }),
		[],
		[],
	);

	expect(result).toHaveLength(MAX_SUGGESTIONS);
});

test("una etiqueta que incumple la normalización de T18 se descarta", () => {
	// «demasiado larga…» se recorta a null por MAX_TAG_LENGTH; los espacios se
	// colapsan; las vacías desaparecen.
	const result = parseSuggestedTags(
		JSON.stringify({
			tags: ["a".repeat(30), "  música   clásica  ", "", "   ", "Verano"],
		}),
		[],
		[],
	);

	expect(result).toEqual(["música clásica", "verano"]);
});

test("las repetidas se deduplican, conservando la primera aparición", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["Música", "música", "MÚSICA "] }),
		[],
		[],
	);

	expect(result).toEqual(["música"]);
});

test("un valor que no es un array de etiquetas no rompe: lista vacía", () => {
	expect(
		parseSuggestedTags(JSON.stringify({ tags: "música" }), [], []),
	).toEqual([]);
	expect(parseSuggestedTags(JSON.stringify({}), [], [])).toEqual([]);
	expect(parseSuggestedTags("no es JSON", [], [])).toEqual([]);
	expect(parseSuggestedTags("[1,2,3]", [], [])).toEqual([]);
});

test("los elementos que no son texto se ignoran, no rompen el resto", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["música", 42, null, { x: 1 }, "verano"] }),
		[],
		[],
	);

	expect(result).toEqual(["música", "verano"]);
});

test("acepta JSON envuelto en un bloque de código", () => {
	const result = parseSuggestedTags(
		'```json\n{"tags":["música"]}\n```',
		[],
		[],
	);

	expect(result).toEqual(["música"]);
});

// --- Las ya puestas en este evento se excluyen, no sólo se piden con menos
//     ganas: confiar en que el modelo no repita lo que ya ve puesto es
//     exactamente la clase de instrucción que T23 enseñó a comprobar. -------

test("una etiqueta ya puesta en este evento no se vuelve a sugerir", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["cena", "trabajo", "equipo"] }),
		[],
		["cena"],
	);

	expect(result).toEqual(["trabajo", "equipo"]);
});

test("la exclusión normaliza antes de comparar: mayúsculas y espacios no cuelan", () => {
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["Cena", "  trabajo  "] }),
		[],
		["cena", "trabajo"],
	);

	expect(result).toEqual([]);
});

test("excluir no reduce el resultado por debajo de lo que el modelo sí propuso de nuevo", () => {
	// Si el modelo respeta la instrucción y no repite ninguna, la exclusión no
	// debe recortar nada de lo demás.
	const result = parseSuggestedTags(
		JSON.stringify({ tags: ["trabajo", "equipo"] }),
		[],
		["cena"],
	);

	expect(result).toEqual(["trabajo", "equipo"]);
});

// --- El prompt --------------------------------------------------------------

test("el prompt incluye el contenido del evento y el vocabulario conocido", () => {
	const prompt = suggestTagsPrompt(input());

	expect(prompt).toContain("Concierto de verano");
	expect(prompt).toContain("Auditorio");
	expect(prompt).toContain("música");
	expect(prompt).toContain("amigos");
});

test("el prompt pide priorizar las etiquetas ya usadas", () => {
	expect(suggestTagsPrompt(input())).toContain("Prefer");
});

test("sin vocabulario previo, el prompt no promete un vocabulario vacío", () => {
	// Con `knownTags: []`, listar "Existing tags: " sin nada detrás confundiría
	// al modelo más que omitir la sección entera.
	const prompt = suggestTagsPrompt(input({ knownTags: [] }));

	expect(prompt).not.toContain("Existing tags:");
});

test("el prompt le dice al modelo qué etiquetas no repetir, sólo si hay alguna", () => {
	expect(suggestTagsPrompt(input({ chosenTags: ["cena"] }))).toContain(
		"do not suggest these again: cena",
	);
	expect(suggestTagsPrompt(input({ chosenTags: [] }))).not.toContain(
		"do not suggest these again",
	);
});

// --- suggestTagsWithAi(), el camino completo -------------------------------------

test("propone etiquetas a partir del contenido del evento", async () => {
	const result = await suggestTagsWithAi(
		answering(JSON.stringify({ tags: ["música", "verano"] })),
		input(),
	);

	expect(result).toEqual(["música", "verano"]);
});

test("el camino completo también excluye las ya puestas en el evento", async () => {
	const result = await suggestTagsWithAi(
		answering(JSON.stringify({ tags: ["cena", "trabajo"] })),
		input({ chosenTags: ["cena"] }),
	);

	expect(result).toEqual(["trabajo"]);
});

test("un fallo del modelo no se propaga: silencio, lista vacía", async () => {
	// «Si la IA no está disponible, silencio y ningún error»: a diferencia de
	// generate-event.ts, esto es una sugerencia de fondo y nunca debe
	// interrumpir el guardado con un mensaje.
	const generate: GenerateContent = async () => {
		throw new Error("model unavailable");
	};

	await expect(suggestTagsWithAi(generate, input())).resolves.toEqual([]);
});

test("una respuesta que no es JSON también resuelve en silencio", async () => {
	await expect(
		suggestTagsWithAi(answering("Claro, aquí tienes:"), input()),
	).resolves.toEqual([]);
});

test("manda el contenido en una sola parte, no en varias", async () => {
	let enviado: unknown[] = [];
	const generate: GenerateContent = async (parts) => {
		enviado = parts;
		return JSON.stringify({ tags: [] });
	};

	await suggestTagsWithAi(generate, input());

	expect(enviado).toHaveLength(1);
	expect(enviado[0]).toMatchObject({
		text: expect.stringContaining("Concierto de verano"),
	});
});
