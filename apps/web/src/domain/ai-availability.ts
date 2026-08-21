/**
 * Availability of the browser's built-in AI.
 *
 * This is what Chrome's best-practices guide recommends: don't offer the
 * feature if the device can't provide it. A button that always fails is
 * worse than no button at all.
 */

/** States returned by `LanguageModel.availability()`. */
export type ModelAvailability =
	| "unavailable"
	| "downloadable"
	| "downloading"
	| "available";

interface LanguageModelGlobal {
	availability(): Promise<ModelAvailability>;
}

function languageModel(): LanguageModelGlobal | undefined {
	return (globalThis as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
}

/**
 * Whether it's worth offering AI generation.
 *
 * `downloadable` counts: the model isn't there but it can be fetched, and we
 * warn about the wait. `downloading` counts too, because it's already on its
 * way. It's only hidden with `unavailable` or when the browser doesn't even
 * have the API.
 */
export function canOffer(availability: ModelAvailability | undefined): boolean {
	return availability !== undefined && availability !== "unavailable";
}

/** Asks the browser. Returns `undefined` if it doesn't support the API. */
export async function checkAvailability(): Promise<
	ModelAvailability | undefined
> {
	const api = languageModel();
	if (!api) return undefined;

	try {
		return await api.availability();
	} catch {
		// Some environments expose the object but fail when querying it; it's
		// treated the same as not having it.
		return undefined;
	}
}

/** Whether it's worth warning about a long download before starting. */
export function needsDownload(
	availability: ModelAvailability | undefined,
): boolean {
	return availability === "downloadable" || availability === "downloading";
}
