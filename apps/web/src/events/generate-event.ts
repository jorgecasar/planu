/**
 * Extracting event data from an image.
 *
 * The prototype did this with a Genkit flow run on the Next.js server. Here
 * it is resolved on the client with Firebase AI Logic in hybrid mode: Gemini
 * Nano on the device if it is available, Gemini in the cloud if not.
 */

import type { EventPart } from "../application/ports/ai-model.js";
import { toInputDate } from "../domain/format-dates.js";

export interface GeneratedEvent {
	title: string;
	description: string;
	location: string;
	startDate: Date | null;
	endDate: Date | null;
	/**
	 * Whether either date carries an hour. Without this, the extraction lost
	 * the hour the instant it had gotten it: the editor only shows the time
	 * fields when `allDay` is `false` (decision 4 of the hours spec), and
	 * `draft.allDay` always arrived `undefined` — all-day by default.
	 */
	allDay: boolean;
}

/**
 * The only thing this module needs: something that receives the message
 * parts and returns text.
 *
 * The dependency is inverted on purpose. Typing Firebase's `GenerativeModel`
 * here would couple the logic to the SDK and force the whole thing to be
 * mocked in the tests; this way the adapter lives in the component and this
 * is tested with a three-line function.
 */
export type GenerateContent = (parts: EventPart[]) => Promise<string>;

/**
 * The date rules, which are the same for the image and for the text.
 *
 * Three things the model does not resolve on its own, and each used to cost
 * a badly filled field:
 *
 * 1. **It does not know what day it is.** Asking it to "assume the current
 *    year" was asking it for data it does not have; faced with "20 June" it
 *    either made one up or left the year out.
 * 2. **It writes the date in the language of the text** unless told
 *    otherwise, and no `Date` understands "20 de junio".
 * 3. **Start and end are not always the same case.** A dinner happens on one
 *    day — start and end the same —; a course that "starts on 1 September"
 *    has no end; and "before 30 June" is a deadline, which is an **end** and
 *    not a start. Filling them in with a fixed rule gets two out of three
 *    wrong.
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

/** Reused almost verbatim from the prototype's Genkit flow. */
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
 * Flat JSON schema for the browser AI's `responseConstraint`.
 *
 * The on-device model does not see the cloud configuration: without this
 * restriction, Gemini Nano answers in prose and parsing fails.
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
 * Strips the code fence many models wrap the JSON in. It happens even when
 * structured output is requested, especially in smaller models.
 *
 * Exported because `suggest-tags.ts` needs it too: the same model, the same
 * tic. Duplicating it would be exactly the drift a T23 review asked to
 * avoid.
 */
export function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("```")) return trimmed;
	return trimmed
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```$/, "")
		.trim();
}

/** Encodes the file as base64 without dumping it whole onto the call stack. */
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
 * Converts to Date only what really is one, and **only in ISO 8601**.
 *
 * Plain `new Date(text)` stopped being used because it accepts too much, and
 * unpredictably: `"June 20"` comes out as **2001**, and a date like that,
 * put into the form with no warning, gets saved with a mistake nobody
 * notices. An empty field the user fills in is better than one filled in
 * with the wrong year.
 *
 * The date-only case is built with local components: `new Date` interprets
 * `"2026-06-20"` as midnight **UTC**, which west of Greenwich falls on the
 * previous day. It is the same reason `toInputDate` does not go through
 * `toISOString()`.
 *
 * `null` with no recognisable date; otherwise, the date and whether the text
 * carried a time. That distinction lives here and isn't guessed afterward
 * from the resulting `Date`'s own components: a date-only string and one
 * with an explicit `00:00` time produce the same local instant, but mean
 * different things — all-day versus a midnight appointment.
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
		// `new Date(26, …)` is **1926**: the constructor maps two-digit years
		// to the 20th century, and the check below would consider it valid.
		local.setFullYear(year);
		// `new Date(2026, 5, 32)` silently overflows into July.
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
 * Interprets the model's response.
 *
 * Even when structured output is requested, the model can return text that
 * is not valid JSON; and Gemini Nano, being considerably smaller, fails
 * more often. That is why the parsing is defensive and the result always
 * goes through the editor for the user to review before saving.
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

/** Asks the model for the event data shown in the image. */
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
