import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";

import { consume } from "@lit/context";
import type { FirebaseApp } from "firebase/app";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { appContext } from "../firebase/context.js";
import {
	type GeneratedEvent,
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

	@state() private preview = "";
	@state() private busy = false;
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
									<span>Reading the image…</span>
								</div>`
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
			this.#emit(generated);
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

	#emit(generated: GeneratedEvent): void {
		this.dispatchEvent(
			new CustomEvent<GeneratedEvent>("planu-event-generated", {
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
