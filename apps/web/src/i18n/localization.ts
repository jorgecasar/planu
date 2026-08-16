import { configureLocalization } from "@lit/localize";
import { browserLocales, pickLocale } from "../domain/pick-locale.js";
import {
	sourceLocale,
	targetLocales,
} from "../generated/locales/locale-codes.js";

const { getLocale, setLocale } = configureLocalization({
	sourceLocale,
	targetLocales,
	loadLocale: (locale) => import(`../generated/locales/${locale}.js`),
});

/**
 * El idioma que la interfaz está sirviendo ahora mismo.
 *
 * No basta con el del navegador: si éste pide alemán, la interfaz sirve inglés,
 * y un calendario formateado en alemán dentro de una interfaz en inglés sería
 * una mezcla. Lo que manda es lo que el usuario está leyendo.
 */
export { getLocale };

/** Todos los idiomas que la interfaz sabe servir. */
export const availableLocales = [sourceLocale, ...targetLocales] as const;

/**
 * Fija el idioma de la interfaz a partir del navegador.
 *
 * Se espera a que termine antes del primer render: cargar el idioma después
 * pintaría la aplicación en inglés y la haría saltar al idioma correcto a la
 * vista del usuario.
 *
 * Un fallo al cargar las traducciones no debe dejar la aplicación en blanco;
 * el idioma de origen ya está en el bundle, así que se sigue en inglés.
 */
export async function initLocale(): Promise<string> {
	const locale = pickLocale(browserLocales(), availableLocales, sourceLocale);
	if (locale === sourceLocale) return locale;

	try {
		await setLocale(locale);
		return locale;
	} catch {
		return sourceLocale;
	}
}
