import { expect, test } from "vitest";
import { browserLocales, pickLocale } from "./pick-locale.js";

const AVAILABLE = ["en", "es"] as const;

test("usa el idioma del usuario cuando está disponible", () => {
	expect(pickLocale(["es"], AVAILABLE, "en")).toBe("es");
});

test("ignora la región si el idioma base está disponible", () => {
	// Un usuario en es-AR debe ver español, no inglés.
	expect(pickLocale(["es-AR"], AVAILABLE, "en")).toBe("es");
	expect(pickLocale(["en-GB"], AVAILABLE, "en")).toBe("en");
});

test("cae a inglés cuando no hay nada que encaje", () => {
	expect(pickLocale(["ja", "ko"], AVAILABLE, "en")).toBe("en");
});

test("respeta el orden de preferencia del usuario", () => {
	// Prefiere español aunque inglés también esté disponible y vaya después.
	expect(pickLocale(["es-ES", "en-US"], AVAILABLE, "en")).toBe("es");
	expect(pickLocale(["en-US", "es-ES"], AVAILABLE, "en")).toBe("en");
});

test("la coincidencia exacta gana sobre la de subetiqueta", () => {
	expect(pickLocale(["es-MX"], ["es", "es-MX"], "en")).toBe("es-MX");
});

test("no distingue mayúsculas en las etiquetas", () => {
	expect(pickLocale(["ES-es"], AVAILABLE, "en")).toBe("es");
});

test("sin preferencias devuelve el respaldo", () => {
	expect(pickLocale([], AVAILABLE, "en")).toBe("en");
});

test("lee las preferencias del navegador, con language de respaldo", () => {
	expect(
		browserLocales({
			languages: ["es-ES", "es"],
			language: "es-ES",
		} as unknown as Navigator),
	).toEqual(["es-ES", "es"]);

	// Safari antiguo y algunos entornos sólo exponen `language`.
	expect(
		browserLocales({ languages: [], language: "fr-FR" } as unknown as Navigator),
	).toEqual(["fr-FR"]);
});
