/**
 * AI tag suggestion when saving an event that has none.
 *
 * It is one more caller of the same model as `generate-event.ts` and
 * `generate-from-text.ts`, with two differences that change everything
 * else:
 *
 * 1. **It is a background convenience, not something the user explicitly
 *    asked for.** T23 shows an error when generation fails because the user
 *    just pressed a button to request it; here there is no such request,
 *    so no failure ever becomes visible. `suggestTagsWithAi()` never
 *    throws: a model that does not answer, answers garbage, or is
 *    unavailable resolves to an empty list, and the editor stays exactly as
 *    if this function did not exist.
 * 2. **The priority of already-used tags is not left to the model.** Asking
 *    for it in the prompt helps, but T23 showed that trusting a small model
 *    to obey an ordering cannot be verified without built-in AI in front of
 *    you. Here it is deterministically reordered after parsing, so it is a
 *    guarantee a unit test can pin down without needing the model to
 *    cooperate.
 */

import { normalizeTag } from "../domain/tags.js";
import { type GenerateContent, stripCodeFence } from "./generate-event.js";

/** At most three, so as not to turn saving into a whole new form. */
export const MAX_SUGGESTIONS = 3;

/** Flat JSON schema for `responseConstraint`: a single key, an array of text. */
export const TAG_SUGGESTION_SCHEMA = {
	type: "object",
	properties: { tags: { type: "array", items: { type: "string" } } },
	required: ["tags"],
} as const;

export interface SuggestTagsInput {
	title: string;
	description: string;
	location: string;
	/** The user's vocabulary: their tags already used on other events. */
	knownTags: readonly string[];
	/**
	 * The ones already applied to this event. They are excluded from the
	 * result, not merely requested with less enthusiasm: trusting the model
	 * not to repeat a tag it already sees applied is exactly the kind of
	 * instruction T23 taught us not to consider fulfilled without checking.
	 */
	chosenTags: readonly string[];
}

/**
 * Instructions for the model.
 *
 * Asks it to reuse the user's vocabulary before inventing a new one —
 * "music" and "concerts" coexisting on the same account is exactly what
 * T18's normalisation exists to prevent — and restricts the response to
 * JSON with a single key so the parsing does not have to guess the shape.
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
 * Interprets the model's response.
 *
 * Never throws: a response that is not JSON, that does not carry an array,
 * or whose items are not text, becomes "no suggestions" instead of an
 * error. It is the same thing T23 decided for dates — empty rather than
 * made up — but taken one step further, because here there is not even a
 * user waiting for a response to react to.
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
		// `chosen` outside the model: the prompt's instruction helps, but what
		// actually keeps an already-applied tag from being repeated is this
		// filter.
		if (tag === null || seen.has(tag) || chosen.has(tag)) continue;
		seen.add(tag);
		cleaned.push(tag);
	}

	// Stable since ES2019: between two new tags, or between two already
	// known ones, the order the model proposed is preserved.
	cleaned.sort((a, b) => Number(known.has(b)) - Number(known.has(a)));

	return cleaned.slice(0, MAX_SUGGESTIONS);
}

/**
 * Asks the model for tags for the event. Never fails: see the module's
 * docblock for why this is a background convenience and not a generation.
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
