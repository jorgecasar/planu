import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";

import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";

import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import type { FirebaseStorage } from "firebase/storage";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	appContext,
	storageContext,
	userContext,
} from "../firebase/context.js";
import { uploadFile } from "../firebase/storage.js";
import type { PlanuEvent } from "../lib/types.js";

/** Lo que devuelve `getGenerativeModel`, sin importar el SDK en el arranque. */
type GenerativeModelInstance = Awaited<
	ReturnType<
		Awaited<typeof import("firebase/ai")>["getGenerativeModel"] extends (
			...args: infer _A
		) => infer R
			? () => R
			: never
	>
>;

import {
	checkAvailability,
	type ModelAvailability,
	needsDownload,
} from "./ai-availability.js";
import {
	type InferenceModeName,
	type InferenceSourceName,
	resolveInferenceMode,
} from "./ai-policy.js";
import {
	GenerationError,
	generateEventFromImage,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";

/** Lo que el generador entrega al editor. */
export interface GeneratedDraft {
	event: Partial<PlanuEvent>;
	/** Dónde se resolvió: útil para el usuario y para vigilar el gasto. */
	source: InferenceSourceName | undefined;
}

/**
 * Genera un evento a partir de la foto de un cartel.
 *
 * Usa Firebase AI Logic en modo híbrido: si el navegador trae IA integrada
 * corre en el dispositivo —gratis, sin red y sin que la imagen salga de aquí—;
 * si no, cae a Gemini en la nube. Lo que devuelva pasa siempre por el editor
 * para que el usuario lo revise: Gemini Nano se equivoca a menudo con fechas.
 */
@customElement("planu-ai-event-generator")
export class PlanuAiEventGenerator extends LitElement {
	static override styles = css`
		.drop {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);
		}

		img {
			inline-size: 100%;
			block-size: 12rem;
			object-fit: contain;
		}

		.working {
			display: flex;
			align-items: center;
			gap: var(--wa-space-s);
		}
	`;

	@property({ type: Boolean }) open = false;

	@consume({ context: appContext, subscribe: true })
	private app: FirebaseApp | undefined;

	@consume({ context: storageContext, subscribe: true })
	private storage: FirebaseStorage | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: User | null | undefined;

	@state() private preview = "";
	@state() private busy = false;
	@state() private uploading = false;
	@state() private downloading = false;
	@state() private progress = 0;
	@state() private error = "";

	@state() private availability: ModelAvailability | undefined;

	/** Se reutiliza entre aperturas: preparar el modelo dos veces no aporta. */
	#warmup: Promise<void> | undefined;

	/** El modelo también: construirlo dos veces duplicaría la inicialización. */
	#modelPromise: Promise<GenerativeModelInstance> | undefined;

	/**
	 * Cambia al cerrar el diálogo. Todo lo que estuviera en vuelo comprueba su
	 * token antes de tener efecto: sin esto, cancelar no cancelaba nada y una
	 * generación tardía subía la imagen y reabría el editor igualmente.
	 */
	#generation = 0;

	override willUpdate(changed: Map<string, unknown>): void {
		if (changed.has("open") && this.open) {
			this.#revokePreview();
			this.preview = "";
			this.progress = 0;
			this.error = "";
			this.downloading = false;
			// Abrir el diálogo ya es intención clara: Chrome recomienda preparar
			// el modelo aquí y no al pulsar generar, para que la descarga ocurra
			// mientras el usuario elige la foto en vez de después.
			void this.#warmUp();
		}
	}

	/** Prepara el modelo en segundo plano. Los errores esperan al generar. */
	async #warmUp(): Promise<void> {
		this.availability = await checkAvailability();
		if (!this.app) return;

		this.#warmup ??= (async () => {
			const model = await this.#model();
			await model.initializeDeviceModel((progreso) => {
				this.downloading = true;
				this.progress = progreso * 100;
			});
			this.downloading = false;
		})();

		try {
			await this.#warmup;
		} catch {
			// Silencio a propósito: el usuario todavía no ha pedido nada. Si
			// falla de verdad, lo sabrá al intentar generar, con su mensaje.
			this.#warmup = undefined;
		}
	}

	override render() {
		return html`
			<wa-dialog
				label=${msg("Generate event from an image")}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
				<p>
					${msg(
						"Upload a poster or flyer and the details will be filled in for you. You can review everything before saving.",
					)}
				</p>

				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}

				${
					// Avisar antes, no después: la descarga puede tardar minutos y
					// una espera sin explicación parece que se ha colgado.
					needsDownload(this.availability)
						? html`<wa-callout variant="neutral">
								${msg("The first time, your browser downloads the AI model. It can take a few minutes and only happens once.")}
							</wa-callout>`
						: nothing
				}

				<div class="drop">
					<label for="ai-image">${msg("Event image")}</label>
					${this.preview ? html`<img src=${this.preview} alt="" />` : nothing}
					<input
						id="ai-image"
						type="file"
						accept="image/png, image/jpeg"
						?disabled=${this.busy}
						@change=${this.#onFile}
					/>
					${
						this.busy || this.downloading
							? html`<div class="working">
									<wa-spinner></wa-spinner>
									<span>
										${
											this.downloading
												? msg(
														"Downloading the AI model, this can take a few minutes…",
													)
												: this.uploading
													? msg("Saving the image…")
													: msg("Reading the image…")
										}
									</span>
								</div>`
							: nothing
					}
					${
						this.uploading || this.downloading
							? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
							: nothing
					}
				</div>

				<wa-button slot="footer" appearance="outlined" @click=${this.#close}>
					${msg("Cancel")}
				</wa-button>
			</wa-dialog>
		`;
	}

	/**
	 * Construye el modelo. Sólo en el dispositivo.
	 *
	 * `only_on_device` espera a que la descarga termine en vez de resolver por
	 * otro camino, y ante un problema lanza la causa real en lugar de callar.
	 * No hay `inCloudParams` a propósito: reactivar la nube exige volver a
	 * añadirlos y configurar App Check, no cambiar una variable de entorno.
	 */
	async #buildModel() {
		// Importación dinámica: el SDK de IA pesa cientos de kB y la mayoría de
		// las sesiones no lo usan nunca. No debe entrar en el arranque.
		const { getAI, getGenerativeModel, GoogleAIBackend } = await import(
			"firebase/ai"
		);

		// biome-ignore lint/style/noNonNullAssertion: sólo se llama con app
		const ai = getAI(this.app!, { backend: new GoogleAIBackend() });
		return getGenerativeModel(ai, {
			mode: await this.#inferenceMode(),
			onDeviceParams: {
				createOptions: {
					expectedInputs: [{ type: "text" }, { type: "image" }],
				},
				promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
			},
		});
	}

	/** Una sola instancia por sesión: el calentamiento y la generación comparten. */
	#model() {
		this.#modelPromise ??= this.#buildModel();
		return this.#modelPromise;
	}

	#revokePreview(): void {
		if (this.preview.startsWith("blob:")) URL.revokeObjectURL(this.preview);
	}

	async #onFile(domEvent: globalThis.Event): Promise<void> {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !this.app) return;

		const token = this.#generation;
		this.#revokePreview();
		this.preview = URL.createObjectURL(file);
		this.error = "";
		this.busy = true;

		try {
			// El modelo ya se estaba preparando desde que se abrió el diálogo;
			// aquí sólo se espera a que termine si aún no lo ha hecho.
			await this.#warmUp();
			const model = await this.#model();

			let source: InferenceSourceName | undefined;
			const generated = await generateEventFromImage(async (parts) => {
				const result = await model.generateContent({
					contents: [{ role: "user", parts }],
				});
				// El SDK dice dónde acabó ejecutándose; es la única forma fiable
				// de saberlo, porque el modo sólo expresa una preferencia.
				source = result.response.inferenceSource as
					| InferenceSourceName
					| undefined;
				return result.response.text();
			}, file);

			// Si el usuario canceló mientras el modelo pensaba, aquí se para: ni
			// se sube la imagen ni se reabre el editor a su espalda.
			if (token !== this.#generation) return;

			// El cartel del que se extrajo el evento es su portada natural. Se
			// sube después de generar, no antes, para no dejar en Storage las
			// imágenes de los intentos que no llegan a nada.
			this.#emit({
				event: { ...generated, imageUrl: await this.#uploadCover(file) },
				source,
			});
			this.#close();
		} catch (cause) {
			if (token !== this.#generation) return;
			this.error =
				cause instanceof GenerationError
					? msg("The image could not be read as an event. Try a clearer photo.")
					: msg(
							"Event generation is unavailable right now. You can still create the event by hand.",
						);
		} finally {
			this.busy = false;
			this.downloading = false;
			input.value = "";
		}
	}

	/**
	 * Sube el cartel como portada. Devuelve cadena vacía si no puede.
	 *
	 * Un fallo aquí no invalida lo que la IA acaba de extraer: es peor perder
	 * los datos del evento que quedarse sin imagen, así que se abre el editor
	 * igualmente y el usuario puede añadirla a mano.
	 */
	async #uploadCover(file: File): Promise<string> {
		const { storage, user } = this;
		if (!storage || !user) return "";

		this.uploading = true;
		this.progress = 0;
		try {
			return await uploadFile(
				storage,
				file,
				`events/${user.uid}`,
				(percent) => {
					this.progress = percent;
				},
			);
		} catch {
			return "";
		} finally {
			this.uploading = false;
		}
	}

	/**
	 * Decide si esta sesión puede recurrir a la nube.
	 *
	 * El derecho viaja en un claim del token, no en Firestore: así el permiso
	 * lo concede el servidor y el cliente no puede dárselo a sí mismo.
	 */
	async #inferenceMode(): Promise<InferenceModeName> {
		const cloudEnabled = import.meta.env.VITE_AI_CLOUD_FALLBACK === "true";

		let premium = false;
		if (cloudEnabled && this.user) {
			try {
				const token = await this.user.getIdTokenResult();
				premium = token.claims["premium"] === true;
			} catch {
				premium = false;
			}
		}

		return resolveInferenceMode({ cloudEnabled, premium });
	}

	#emit(draft: GeneratedDraft): void {
		this.dispatchEvent(
			new CustomEvent<GeneratedDraft>("planu-event-generated", {
				detail: draft,
				bubbles: true,
				composed: true,
			}),
		);
	}

	#close(): void {
		this.#generation++;
		this.#revokePreview();
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-generator-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-ai-event-generator": PlanuAiEventGenerator;
	}
}
