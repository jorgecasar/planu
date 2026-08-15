/**
 * Extracción de los datos de un evento a partir de una imagen.
 *
 * El prototipo hacía esto con un flow de Genkit ejecutado en el servidor de
 * Next. Aquí se resuelve en el cliente con Firebase AI Logic en modo híbrido:
 * Gemini Nano en el dispositivo si está disponible, Gemini en la nube si no.
 */

export interface GeneratedEvent {
	title: string;
	description: string;
	location: string;
	startDate: Date | null;
	endDate: Date | null;
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

/** Reaprovechado casi literalmente del flow de Genkit del prototipo. */
export const EXTRACTION_PROMPT = `You are an expert event planner. Extract event details from the provided image.
Analyze the image, which could be a poster, a photo of an event in progress, or a flyer.
Identify the event's title, a detailed description, its location, and start/end dates.

- If the image contains text, prioritize it for extracting details.
- If there is no text, infer the details from the visual context. For example, a picture of a birthday party could be titled "Birthday Celebration".
- If a date is mentioned but no year, assume the current year.
- If a specific time is not mentioned, you can leave it out.
- Be creative but accurate. The goal is to create a complete and helpful event entry.`;

/** Estructura que se le exige al modelo mediante responseSchema. */
export const RESPONSE_FIELDS = {
	title: "A concise and appealing title for the event.",
	description: "A detailed description of the event.",
	location: "The physical or virtual location of the event.",
	startDate: "Start date and time in ISO 8601 format, or an empty string.",
	endDate: "End date and time in ISO 8601 format, or an empty string.",
} as const;

/** Codifica el fichero en base64 sin volcarlo entero en la pila de llamadas. */
export async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Convierte a Date sólo lo que de verdad lo es. */
function toDate(value: unknown): Date | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
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
		raw = JSON.parse(text);
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

	return {
		title,
		description: asText("description"),
		location: asText("location"),
		startDate: toDate(record["startDate"]),
		endDate: toDate(record["endDate"]),
	};
}

/** Pide al modelo los datos del evento que muestra la imagen. */
export async function generateEventFromImage(
	generate: GenerateContent,
	file: File,
): Promise<GeneratedEvent> {
	const text = await generate([
		{ text: EXTRACTION_PROMPT },
		{ inlineData: { mimeType: file.type, data: await fileToBase64(file) } },
	]);

	return parseGeneratedEvent(text);
}
