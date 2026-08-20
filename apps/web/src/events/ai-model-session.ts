/**
 * La parte de la generación con IA que no tiene nada de Lit ni de Firebase:
 * disponibilidad de la sesión, caché del modelo, autocuración tras un fallo,
 * descarga y resolución del modo de inferencia.
 *
 * Vivía duplicada dentro de `ai-event-generator.ts` sólo por ser el único
 * componente que la necesitaba. T24 necesita lo mismo en `event-editor.ts`
 * para sugerir etiquetas, y duplicarla ahí sería exactamente la deuda que una
 * revisión de T23 señaló como pendiente.
 *
 * **No importa `firebase/*` en ningún sitio, a propósito.** Extraer esto a un
 * fichero que sí importara el SDK habría añadido un fichero acoplado nuevo —
 * `arch/boundary.test.ts` fija el tope en 23 y sólo puede bajar—, así que en
 * vez de traer aquí `getAI`/`getGenerativeModel` se recibe `buildModel` ya
 * construido: quien llama es quien ya tiene el acoplamiento legítimo —un
 * componente con `@consume` de contextos de Firebase—, y aquí sólo vive la
 * orquestación, que es justo lo que es agnóstico al proveedor.
 *
 * Esto también es lo que abre la costura que faltaba: sin ella, nada de esto
 * se podía probar sin hablar con Firebase de verdad, y la cancelación y
 * auto-curación tras un fallo se quedaron sin ningún test en T23 por ese
 * motivo exacto.
 */

import {
	type InferenceModeName,
	type InferenceSourceName,
	resolveInferenceMode,
} from "../domain/ai-policy.js";
import type { EventPart } from "./generate-event.js";

/**
 * Lo mínimo de una sesión de usuario que hace falta: el claim de premium.
 * Duck typing en vez de `User` de `firebase/auth`, para no importarlo aquí.
 */
export interface TokenClaims {
	getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
}

/** Lo mínimo de un modelo generativo que hace falta, sin el tipo real del SDK. */
export interface ModelLike {
	initializeDeviceModel(onProgress: (progress: number) => void): Promise<void>;
	// El SDK real restringe `role` a una unión de literales; aquí sólo hace
	// falta "user", que es el único que este módulo envía.
	generateContent(input: {
		contents: Array<{ role: "user"; parts: EventPart[] }>;
	}): Promise<{ response: { text(): string; inferenceSource?: string } }>;
}

export interface GeneratedResponse {
	text: string;
	/** El SDK dice dónde acabó ejecutándose; el modo sólo es una preferencia. */
	source: InferenceSourceName | undefined;
}

export interface AiModelSessionOptions {
	/**
	 * Función y no valor: el claim de premium se relee en cada construcción del
	 * modelo, así que hace falta la sesión actual en ese instante, no la que
	 * había cuando se creó esta sesión.
	 */
	getUser: () => TokenClaims | null | undefined;
	/**
	 * Construye el modelo ya resuelto el modo. Quien llama conoce el SDK; esto
	 * no necesita conocerlo para cachear, cancelar y autocurarse.
	 */
	buildModel: (mode: InferenceModeName) => Promise<ModelLike>;
	/** Se le avisa del modo resuelto; útil para no prometer privacidad de más. */
	onInferenceMode?: (mode: InferenceModeName) => void;
}

export interface AiModelSession {
	/** Prepara el modelo en el dispositivo. Memoizado: llamar dos veces no repite la descarga. */
	warmUp(onProgress: (percent: number) => void): Promise<void>;
	/** Genera a partir de las partes del mensaje. */
	generate(parts: EventPart[]): Promise<GeneratedResponse>;
}

/**
 * Construye una sesión de modelo.
 *
 * `only_on_device` espera a que la descarga termine en vez de resolver por
 * otro camino, y ante un problema lanza la causa real en lugar de callar. No
 * hay `inCloudParams` a propósito: reactivar la nube exige volver a añadirlos
 * y configurar App Check en quien construye el modelo, no cambiar una
 * variable de entorno.
 */
export function createAiModelSession(
	options: AiModelSessionOptions,
): AiModelSession {
	/**
	 * Una sola instancia por sesión: el calentamiento y la generación
	 * comparten. Un rechazo **no** se queda memoizado —si se guardase, un fallo
	 * pasajero al construir el modelo dejaría la IA muerta el resto de la
	 * sesión—.
	 */
	let modelPromise: Promise<ModelLike> | undefined;

	/** Igual que `modelPromise`: memoizado, pero no si falla. */
	let warmupPromise: Promise<void> | undefined;

	async function inferenceMode(): Promise<InferenceModeName> {
		const cloudEnabled = import.meta.env.VITE_AI_CLOUD_FALLBACK === "true";

		let premium = false;
		const user = options.getUser();
		if (cloudEnabled && user) {
			try {
				const token = await user.getIdTokenResult();
				premium = token.claims["premium"] === true;
			} catch {
				premium = false;
			}
		}

		const mode = resolveInferenceMode({ cloudEnabled, premium });
		options.onInferenceMode?.(mode);
		return mode;
	}

	function model(): Promise<ModelLike> {
		modelPromise ??= inferenceMode()
			.then((mode) => options.buildModel(mode))
			.catch((cause: unknown) => {
				modelPromise = undefined;
				throw cause;
			});
		return modelPromise;
	}

	return {
		async warmUp(onProgress) {
			warmupPromise ??= (async () => {
				const built = await model();
				await built.initializeDeviceModel((progress) => {
					onProgress(progress * 100);
				});
			})().catch((cause: unknown) => {
				warmupPromise = undefined;
				throw cause;
			});
			return warmupPromise;
		},

		async generate(parts) {
			const built = await model();
			const result = await built.generateContent({
				contents: [{ role: "user", parts }],
			});
			return {
				text: result.response.text(),
				source: result.response.inferenceSource as
					| InferenceSourceName
					| undefined,
			};
		},
	};
}
