import { expect, test, vi } from "vitest";
import {
	canOffer,
	checkAvailability,
	needsDownload,
} from "./ai-availability.js";

test("se ofrece la función salvo que el modelo sea inalcanzable", () => {
	expect(canOffer("available")).toBe(true);
	// Downloadable counts: it can be fetched and we warn about the wait.
	expect(canOffer("downloadable")).toBe(true);
	expect(canOffer("downloading")).toBe(true);
});

test("no se ofrece si no hay modelo ni API", () => {
	expect(canOffer("unavailable")).toBe(false);
	// undefined = the browser doesn't have the API at all.
	expect(canOffer(undefined)).toBe(false);
});

test("avisa de la descarga sólo cuando toca esperar", () => {
	expect(needsDownload("downloadable")).toBe(true);
	expect(needsDownload("downloading")).toBe(true);
	expect(needsDownload("available")).toBe(false);
	expect(needsDownload(undefined)).toBe(false);
});

test("sin la API del navegador devuelve undefined, no lanza", async () => {
	// The absence is simulated instead of assumed: the Chromium these tests
	// run on does bring `LanguageModel` and responds `downloadable`.
	vi.stubGlobal("LanguageModel", undefined);
	expect(await checkAvailability()).toBeUndefined();
	vi.unstubAllGlobals();
});

test("consulta la API cuando existe", async () => {
	vi.stubGlobal("LanguageModel", {
		availability: async () => "downloadable" as const,
	});
	expect(await checkAvailability()).toBe("downloadable");
	vi.unstubAllGlobals();
});

test("un fallo al consultar se trata como no disponible", async () => {
	vi.stubGlobal("LanguageModel", {
		availability: async () => {
			throw new Error("boom");
		},
	});
	expect(await checkAvailability()).toBeUndefined();
	vi.unstubAllGlobals();
});
