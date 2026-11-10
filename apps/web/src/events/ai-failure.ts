import { msg } from "@lit/localize";
import { GenerationError } from "./generate-event.js";
import { TextInputError } from "./generate-from-text.js";

/**
 * What to tell the person in front of the screen when something fails.
 *
 * The three cases are different and lead to different actions: what they
 * pasted isn't valid, no event could be extracted, or the AI isn't
 * available. A single message for all three forces them to guess what to
 * do.
 *
 * `modelReady` decides the middle case, and it's not theoretical: measured
 * against Gemini Nano, a text with no event at all —"Remember to buy milk
 * and batteries"— makes the model **throw an error** instead of answering
 * with the empty title it's asked for. Without this, that text would
 * announce an AI failure that isn't real.
 */
export function explainFailure(state: {
	cause: unknown;
	unreadable: string;
	modelReady: boolean;
}): string {
	if (state.cause instanceof TextInputError) {
		return state.cause.reason === "too-long"
			? msg(
					"That text is too long. Leave just the part that describes the event.",
				)
			: msg("Paste the text of the event first.");
	}

	if (state.cause instanceof GenerationError || state.modelReady) {
		return state.unreadable;
	}

	return msg(
		"Event generation is unavailable right now. You can still create the event by hand.",
	);
}
