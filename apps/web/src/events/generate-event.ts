/**
 * Extracción de los datos de un evento a partir de una imagen.
 *
 * El prototipo hacía esto con un flow de Genkit ejecutado en el servidor de
 * Next. Aquí se resuelve en el cliente con Firebase AI Logic en modo híbrido:
 * Gemini Nano en el dispositivo si está disponible, Gemini en la nube si no.
 */

import { toInputDate } from "../domain/format-dates.js";

export interface GeneratedEvent {
	title: string;
	description: string;
	location: string;
	startDate: Date | null;
	endDate: Date | null;
	/**
	 * Si alguna de las dos fechas trae hora. Sin esto, la extracción perdía la
	 * hora en el mismo instante en que la había conseguido: el editor sólo
	 * muestra los campos de hora cuando `allDay` es `false` (decisión 4 del
	 * spec de horas), y `draft.allDay` llegaba siempre `undefined` — día
	 * completo por defecto.
	 */
	allDay: boolean;
}

export type EventPart =
	| { text: string }
	| { inlineData: { mimeType: string; data: string } };

/**
 * Lo único que este módulo necesita: algo que reciba las partes del mensaje y
 * devuelva texto.
 *
 * Se invierte la dependencia a propósito. Tipar aquí el `GenerativeModel` de
 * Firebase acoplaría la lógica al SDK y obligaría a simularlo entero en los
 * tests; así el adaptador vive en el componente y esto se prueba con una
 * función de tres líneas.
 */
export type GenerateContent = (parts: EventPart[]) => Promise<string>;

/**
 * Las reglas de fecha, que son las mismas para la imagen y para el texto.
 *
 * Tres cosas que el modelo no resuelve solo, y cada una costaba un campo mal
 * puesto:
 *
 * 1. **No sabe en qué día vive.** Pedirle que «asuma el año actual» era pedirle
 *    un dato que no tiene; con «el 20 de junio» delante, o se lo inventaba o lo
 *    dejaba sin año.
 * 2. **Escribe la fecha en el idioma del texto** si nadie le dice otra cosa, y
 *    `20 de junio` no lo entiende ningún `Date`.
 * 3. **Inicio y fin no son el mismo caso siempre.** Una cena ocurre en un día
 *    —inicio y fin, el mismo—; un curso que «empieza el 1 de septiembre» no
 *    tiene fin; y «antes del 30 de junio» es un plazo, que es **fin** y no
 *    inicio. Rellenarlos con una regla fija se equivoca en dos de los tres.
 */
export function dateRules(today: Date): string {
	return `- Today is ${toInputDate(today)}. Resolve "next Friday", "in June" or any date without a year against it.
- If the year is missing, use the current one; if that date has already passed, use the next year.
- Write dates in ISO 8601 and nothing else: YYYY-MM-DD, or YYYY-MM-DDTHH:mm when there is a time. Never in words, never in any other format.
- Something that happens on a single day — a dinner, a meeting, a concert — starts and ends that day: write the same value in both fields.
- Something that starts on a date without saying when it ends: fill the start and leave the end empty.
- A deadline — "before June 30", "until Friday", "by the 15th" — is an end, not a start: fill the end and leave the start empty.
- Never write a date the source does not give.`;
}

/** Reaprovechado casi literalmente del flow de Genkit del prototipo. */
export function extractionPrompt(today: Date): string {
	return `You are an expert event planner. Extract event details from the provided image.
Analyze the image, which could be a poster, a photo of an event in progress, or a flyer.
Identify the event's title, a detailed description, its location, and start/end dates.

- If the image contains text, prioritize it for extracting details.
- If there is no text, infer the details from the visual context. For example, a picture of a birthday party could be titled "Birthday Celebration".
- If a specific time is not mentioned, you can leave it out.
- Be creative but accurate. The goal is to create a complete and helpful event entry.
${dateRules(today)}`;
}

/**
 * Esquema JSON plano para `responseConstraint` de la IA del navegador.
 *
 * El modelo en el dispositivo no ve la configuración de la nube: sin esta
 * restricción, Gemini Nano contesta en prosa y el parseo falla.
 */
export const RESPONSE_JSON_SCHEMA = {
	type: "object",
	properties: {
		title: { type: "string" },
		description: { type: "string" },
		location: { type: "string" },
		startDate: { type: "string" },
		endDate: { type: "string" },
	},
	required: ["title", "description", "location"],
} as const;

/**
 * Quita el bloque de código con el que muchos modelos envuelven el JSON.
 * Ocurre incluso pidiendo salida estructurada, sobre todo en modelos pequeños.
 *
 * Exportada porque `suggest-tags.ts` la necesita igual: el mismo modelo, el
 * mismo tic. Duplicarla sería la clase de deriva que una revisión de T23 pidió
 * evitar.
 */
export function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("```")) return trimmed;
	return trimmed
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```$/, "")
		.trim();
}

/** Codifica el fichero en base64 sin volcarlo entero en la pila de llamadas. */
export async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Convierte a Date sólo lo que de verdad lo es, y **sólo en ISO 8601**.
 *
 * Se dejó de usar `new Date(texto)` a secas porque acepta demasiado y de forma
 * imprevisible: `"June 20"` le sale **2001**, y una fecha así, puesta en el
 * formulario sin avisar, se guarda con un despiste. Un campo vacío que el
 * usuario rellena es mejor que uno relleno con un año equivocado.
 *
 * La fecha de sólo día se construye con componentes locales: `new Date`
 * interpreta `"2026-06-20"` como medianoche **UTC**, que al oeste de Greenwich
 * cae en el día anterior. Es el mismo motivo por el que `toInputDate` no pasa
 * por `toISOString()`.
 *
 * `null` sin fecha reconocible; en otro caso, la fecha y si el texto traía
 * hora. La distinción vive aquí y no se adivina después mirando los
 * componentes del `Date` resultante: una fecha de sólo día y una con hora
 * explícita de `00:00` producen el mismo instante local, pero significan
 * cosas distintas —día completo contra cita a medianoche—.
 */
function toDate(value: unknown): { date: Date; hasTime: boolean } | null {
	if (typeof value !== "string") return null;
	const text = value.trim();

	const day = ISO_DAY.exec(text);
	if (day) {
		const [year, month, date] = [
			Number(day[1]),
			Number(day[2]),
			Number(day[3]),
		];
		const local = new Date(year, month - 1, date);
		// `new Date(26, …)` es **1926**: el constructor mapea los años de dos
		// cifras al siglo XX, y la comprobación de abajo lo daría por bueno.
		local.setFullYear(year);
		// `new Date(2026, 5, 32)` desborda a julio en silencio.
		return local.getMonth() === month - 1 && local.getDate() === date
			? { date: local, hasTime: false }
			: null;
	}

	if (!ISO_INSTANT.test(text)) return null;
	const instant = new Date(text);
	return Number.isNaN(instant.getTime())
		? null
		: { date: instant, hasTime: true };
}

export class GenerationError extends Error {}

/**
 * Interpreta la respuesta del modelo.
 *
 * Aunque se pida salida estructurada, el modelo puede devolver texto que no
 * es JSON válido; y Gemini Nano, bastante más pequeño, falla más. Por eso el
 * parseo es defensivo y el resultado siempre pasa por el editor para que el
 * usuario lo revise antes de guardar.
 */
export function parseGeneratedEvent(text: string): GeneratedEvent {
	let raw: unknown;
	try {
		raw = JSON.parse(stripCodeFence(text));
	} catch {
		throw new GenerationError("The model did not return valid JSON.");
	}

	if (typeof raw !== "object" || raw === null) {
		throw new GenerationError("The model did not return an object.");
	}

	const record = raw as Record<string, unknown>;
	const asText = (key: string) =>
		typeof record[key] === "string" ? (record[key] as string) : "";

	const title = asText("title").trim();
	if (title === "") {
		throw new GenerationError("The model did not return a title.");
	}

	const start = toDate(record["startDate"]);
	const end = toDate(record["endDate"]);

	return {
		title,
		description: asText("description"),
		location: asText("location"),
		startDate: start?.date ?? null,
		endDate: end?.date ?? null,
		allDay: !(start?.hasTime || end?.hasTime),
	};
}

/** Pide al modelo los datos del evento que muestra la imagen. */
export async function generateEventFromImage(
	generate: GenerateContent,
	file: File,
	today: Date = new Date(),
): Promise<GeneratedEvent> {
	const text = await generate([
		{ text: extractionPrompt(today) },
		{ inlineData: { mimeType: file.type, data: await fileToBase64(file) } },
	]);

	return parseGeneratedEvent(text);
}
