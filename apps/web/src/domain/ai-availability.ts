/**
 * Disponibilidad de la IA integrada del navegador.
 *
 * Lo recomienda la guía de buenas prácticas de Chrome: no ofrezcas la función
 * si el dispositivo no puede darla. Un botón que siempre falla es peor que un
 * botón que no está.
 */

/** Estados que devuelve `LanguageModel.availability()`. */
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
 * Si merece la pena ofrecer la generación con IA.
 *
 * `downloadable` cuenta: el modelo no está pero puede traerse, y avisamos de
 * la espera. `downloading` también, porque ya viene de camino. Sólo se oculta
 * con `unavailable` o cuando el navegador ni siquiera tiene la API.
 */
export function canOffer(availability: ModelAvailability | undefined): boolean {
	return availability !== undefined && availability !== "unavailable";
}

/** Pregunta al navegador. Devuelve `undefined` si no soporta la API. */
export async function checkAvailability(): Promise<
	ModelAvailability | undefined
> {
	const api = languageModel();
	if (!api) return undefined;

	try {
		return await api.availability();
	} catch {
		// Algunos entornos exponen el objeto pero fallan al consultarlo; se
		// trata igual que no tenerlo.
		return undefined;
	}
}

/** Si conviene avisar de que habrá una descarga larga antes de empezar. */
export function needsDownload(
	availability: ModelAvailability | undefined,
): boolean {
	return availability === "downloadable" || availability === "downloading";
}
