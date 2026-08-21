/**
 * Picks the interface language from the browser's preferences.
 *
 * Rules, in this order:
 * 1. Exact match with an available language (`es-MX` with `es-MX`).
 * 2. Match by primary subtag (`es-ES` with `es`).
 * 3. English.
 *
 * The order of `navigator.languages` is respected: the user's first
 * preference that can be served wins, even if a later one matches better.
 */
export function pickLocale(
	preferred: readonly string[],
	available: readonly string[],
	fallback: string,
): string {
	const normalize = (tag: string) => tag.toLowerCase();
	const primary = (tag: string) => normalize(tag).split("-")[0] ?? "";

	const byExact = new Map(available.map((tag) => [normalize(tag), tag]));
	const byPrimary = new Map<string, string>();
	// The first one wins: `es` before `es-419` if both were available.
	for (const tag of available) {
		const key = primary(tag);
		if (!byPrimary.has(key)) byPrimary.set(key, tag);
	}

	for (const wanted of preferred) {
		const exact = byExact.get(normalize(wanted));
		if (exact) return exact;

		const loose = byPrimary.get(primary(wanted));
		if (loose) return loose;
	}

	return fallback;
}

/** Browser preferences, with `navigator.language` as a fallback. */
export function browserLocales(nav: Navigator = navigator): readonly string[] {
	if (nav.languages && nav.languages.length > 0) return nav.languages;
	return nav.language ? [nav.language] : [];
}
