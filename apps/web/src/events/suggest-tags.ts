/**
 * Sugerencia de etiquetas con IA al guardar un evento que no tiene ninguna.
 *
 * Es una entrada más al mismo modelo que `generate-event.ts` y
 * `generate-from-text.ts`, con dos diferencias que cambian todo lo demás:
 *
 * 1. **Es una comodidad de fondo, no algo que el usuario pidió expresamente.**
 *    T23 muestra un error cuando la generación falla porque el usuario acaba
 *    de pulsar un botón para pedirla; aquí no hay tal petición, así que
 *    ningún fallo se hace visible. `suggestTagsWithAi()` no lanza nunca: un modelo
 *    que no contesta, contesta basura, o no está disponible, resuelve en una
 *    lista vacía y el editor sigue exactamente igual que si no existiera esta
 *    función.
 * 2. **La prioridad de las etiquetas ya usadas no se le confía al modelo.**
 *    Pedírselo en el prompt ayuda, pero T23 enseñó que confiar en que un
 *    modelo pequeño obedezca un orden no se puede verificar sin IA integrada
 *    delante. Aquí se reordena de forma determinista después de parsear, así
 *    que es una garantía que un test unitario puede fijar sin necesitar que el
 *    modelo coopere.
 */

import { normalizeTag } from "../domain/tags.js";
import { type GenerateContent, stripCodeFence } from "./generate-event.js";

/** Como máximo tres, para no convertir el guardado en un formulario nuevo. */
export const MAX_SUGGESTIONS = 3;

/** Esquema JSON plano para `responseConstraint`: una única clave, un array de texto. */
export const TAG_SUGGESTION_SCHEMA = {
	type: "object",
	properties: { tags: { type: "array", items: { type: "string" } } },
	required: ["tags"],
} as const;

export interface SuggestTagsInput {
	title: string;
	description: string;
	location: string;
	/** El vocabulario del usuario: sus etiquetas ya usadas en otros eventos. */
	knownTags: readonly string[];
	/**
	 * Las que este evento ya tiene puestas. Se excluyen del resultado, no sólo
	 * se piden con menos ganas: confiar en que el modelo no repita una
	 * etiqueta que ya ve puesta es exactamente la clase de instrucción que T23
	 * enseñó a no dar por cumplida sin comprobarlo.
	 */
	chosenTags: readonly string[];
}

/**
 * Instrucciones para el modelo.
 *
 * Pide reutilizar el vocabulario del usuario antes que inventar uno nuevo
 * —«música» y «conciertos» conviviendo en la misma cuenta es justo lo que la
 * normalización de T18 existe para evitar—, y limita la respuesta a JSON con
 * una única clave para que el parseo no tenga que adivinar la forma.
 */
export function suggestTagsPrompt(input: SuggestTagsInput): string {
	const known =
		input.knownTags.length > 0
			? `\n\nExisting tags this user already uses: ${input.knownTags.join(", ")}`
			: "";
	const chosen =
		input.chosenTags.length > 0
			? `\n\nTags already on this event, do not suggest these again: ${input.chosenTags.join(", ")}`
			: "";

	return `You are helping tag a calendar event. Suggest up to ${MAX_SUGGESTIONS} short tags for the event below, in the same language as its content.

Title: ${input.title}
Description: ${input.description}
Location: ${input.location}${known}${chosen}

- Prefer reusing one of the existing tags when it genuinely fits. Only invent a new one when none of the existing tags apply.
- Answer with JSON only: {"tags": ["tag1", "tag2", "tag3"]}. Lowercase, no punctuation.
- If nothing sensible comes to mind, answer {"tags": []}.`;
}

/**
 * Interpreta la respuesta del modelo.
 *
 * Nunca lanza: una respuesta que no es JSON, que no trae un array, o cuyos
 * elementos no son texto, se convierte en «ninguna sugerencia» en vez de en un
 * error. Es lo mismo que decide T23 para las fechas —vacío antes que
 * inventado— pero llevado un paso más allá, porque aquí ni siquiera hay un
 * usuario esperando una respuesta a la que reaccionar.
 */
export function parseSuggestedTags(
	text: string,
	knownTags: readonly string[],
	chosenTags: readonly string[],
): string[] {
	let raw: unknown;
	try {
		raw = JSON.parse(stripCodeFence(text));
	} catch {
		return [];
	}

	if (typeof raw !== "object" || raw === null) return [];
	const tags = (raw as Record<string, unknown>)["tags"];
	if (!Array.isArray(tags)) return [];

	const known = new Set(
		knownTags
			.map((tag) => normalizeTag(tag))
			.filter((tag): tag is string => tag !== null),
	);
	const chosen = new Set(
		chosenTags
			.map((tag) => normalizeTag(tag))
			.filter((tag): tag is string => tag !== null),
	);

	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const item of tags) {
		if (typeof item !== "string") continue;
		const tag = normalizeTag(item);
		// `chosen` fuera del modelo: la instrucción del prompt ayuda, pero lo
		// que de verdad impide repetir una etiqueta ya puesta es este filtro.
		if (tag === null || seen.has(tag) || chosen.has(tag)) continue;
		seen.add(tag);
		cleaned.push(tag);
	}

	// Estable desde ES2019: entre dos etiquetas nuevas, o entre dos ya
	// conocidas, se conserva el orden que propuso el modelo.
	cleaned.sort((a, b) => Number(known.has(b)) - Number(known.has(a)));

	return cleaned.slice(0, MAX_SUGGESTIONS);
}

/**
 * Pide al modelo etiquetas para el evento. Nunca falla: ver el docblock del
 * módulo sobre por qué esto es una comodidad de fondo y no una generación.
 */
export async function suggestTagsWithAi(
	generate: GenerateContent,
	input: SuggestTagsInput,
): Promise<string[]> {
	try {
		const text = await generate([{ text: suggestTagsPrompt(input) }]);
		return parseSuggestedTags(text, input.knownTags, input.chosenTags);
	} catch {
		return [];
	}
}
