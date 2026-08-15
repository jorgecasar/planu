import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";

import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";

import { consume } from "@lit/context";
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
import {
	GenerationError,
	generateEventFromImage,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";

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
	@state() private progress = 0;
	@state() private error = "";

	override willUpdate(changed: Map<string, unknown>): void {
		if (changed.has("open") && this.open) {
			this.preview = "";
			this.error = "";
		}
	}

	override render() {
		return html`
			<wa-dialog
				label="Generate event from an image"
				.open=${this.open}
				@wa-hide=${this.#close}
			>
				<p>
					Upload a poster or flyer and the details will be filled in for you.
					You can review everything before saving.
				</p>

				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}

				<div class="drop">
					<label for="ai-image">Event image</label>
					${this.preview ? html`<img src=${this.preview} alt="" />` : nothing}
					<input
						id="ai-image"
						type="file"
						accept="image/png, image/jpeg"
						?disabled=${this.busy}
						@change=${this.#onFile}
					/>
					${
						this.busy
							? html`<div class="working">
									<wa-spinner></wa-spinner>
									<span>
										${this.uploading ? "Saving the image…" : "Reading the image…"}
									</span>
								</div>`
							: nothing
					}
					${
						this.uploading
							? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
							: nothing
					}
				</div>

				<wa-button slot="footer" appearance="outlined" @click=${this.#close}>
					Cancel
				</wa-button>
			</wa-dialog>
		`;
	}

	async #onFile(domEvent: globalThis.Event): Promise<void> {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !this.app) return;

		this.preview = URL.createObjectURL(file);
		this.error = "";
		this.busy = true;

		try {
			// Importación dinámica: el SDK de IA pesa cientos de kB y la mayoría
			// de las sesiones no lo usan nunca. No debe entrar en el arranque.
			const {
				getAI,
				getGenerativeModel,
				GoogleAIBackend,
				InferenceMode,
				Schema,
			} = await import("firebase/ai");

			const ai = getAI(this.app, { backend: new GoogleAIBackend() });
			const model = getGenerativeModel(ai, {
				mode: InferenceMode.PREFER_ON_DEVICE,
				// El modelo del dispositivo no ve la configuración de la nube: si no
				// se le restringe aquí, contesta en prosa y el parseo falla.
				onDeviceParams: {
					createOptions: {
						expectedInputs: [{ type: "text" }, { type: "image" }],
					},
					promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
				},
				inCloudParams: {
					model: "gemini-2.5-flash",
					generationConfig: {
						responseMimeType: "application/json",
						// Equivale al GenerateEventOutputSchema que el prototipo
						// declaraba con Zod para Genkit.
						responseSchema: Schema.object({
							properties: {
								title: Schema.string({
									description: "A concise and appealing title for the event.",
								}),
								description: Schema.string({
									description: "A detailed description of the event.",
								}),
								location: Schema.string({
									description: "The physical or virtual location of the event.",
								}),
								startDate: Schema.string({
									description:
										"Start date in ISO 8601 format, or an empty string.",
								}),
								endDate: Schema.string({
									description:
										"End date in ISO 8601 format, or an empty string.",
								}),
							},
							optionalProperties: ["startDate", "endDate"],
						}),
					},
				},
			});

			const generated = await generateEventFromImage(async (parts) => {
				const result = await model.generateContent({
					contents: [{ role: "user", parts }],
				});
				return result.response.text();
			}, file);

			// El cartel del que se extrajo el evento es su portada natural. Se
			// sube después de generar, no antes, para no dejar en Storage las
			// imágenes de los intentos que no llegan a nada.
			this.#emit({ ...generated, imageUrl: await this.#uploadCover(file) });
			this.#close();
		} catch (cause) {
			this.error =
				cause instanceof GenerationError
					? "The image could not be read as an event. Try a clearer photo."
					: "Event generation is unavailable right now. You can still create the event by hand.";
		} finally {
			this.busy = false;
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
			return await uploadFile(storage, file, `events/${user.uid}`, (percent) => {
				this.progress = percent;
			});
		} catch {
			return "";
		} finally {
			this.uploading = false;
		}
	}

	#emit(generated: Partial<PlanuEvent>): void {
		this.dispatchEvent(
			new CustomEvent<Partial<PlanuEvent>>("planu-event-generated", {
				detail: generated,
				bubbles: true,
				composed: true,
			}),
		);
	}

	#close(): void {
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-generator-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-ai-event-generator": PlanuAiEventGenerator;
	}
}
