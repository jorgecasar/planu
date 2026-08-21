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
 * The language the interface is currently serving.
 *
 * The browser's is not enough: if it asks for German but the interface serves
 * English, a calendar formatted in German inside an English interface would
 * be a mix. What matters is what the user is actually reading.
 */
export { getLocale };

/** Every language the interface knows how to serve. */
export const availableLocales = [sourceLocale, ...targetLocales] as const;

/**
 * Sets the interface language based on the browser.
 *
 * It is awaited before the first render: loading the language afterward
 * would paint the application in English and make it jump to the right
 * language in front of the user.
 *
 * A failure loading the translations must not leave the application blank;
 * the source language is already in the bundle, so it just stays in English.
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
