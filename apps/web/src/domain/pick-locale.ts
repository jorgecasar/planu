/**
 * Elige el idioma de la interfaz a partir de las preferencias del navegador.
 *
 * Reglas, en este orden:
 * 1. Coincidencia exacta con un idioma disponible (`es-MX` con `es-MX`).
 * 2. Coincidencia por subetiqueta principal (`es-ES` con `es`).
 * 3. Inglés.
 *
 * Se respeta el orden de `navigator.languages`: la primera preferencia del
 * usuario que se pueda servir gana, aunque una posterior encaje mejor.
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
	// El primero gana: `es` antes que `es-419` si ambos estuvieran disponibles.
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

/** Preferencias del navegador, con `navigator.language` como respaldo. */
export function browserLocales(nav: Navigator = navigator): readonly string[] {
	if (nav.languages && nav.languages.length > 0) return nav.languages;
	return nav.language ? [nav.language] : [];
}
