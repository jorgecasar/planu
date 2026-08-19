import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";

import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
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
} from "../domain/ai-availability.js";
import {
	type InferenceModeName,
	type InferenceSourceName,
	resolveInferenceMode,
} from "../domain/ai-policy.js";
import {
	type GenerateContent,
	type GeneratedEvent,
	GenerationError,
	generateEventFromImage,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";
import {
	generateEventFromText,
	MAX_TEXT_LENGTH,
	TextInputError,
} from "./generate-from-text.js";

/** De cuál de las dos entradas salió la generación en curso. */
export type WorkingOn = "image" | "text";

/**
 * Qué está pasando ahora mismo, dicho con las palabras de la entrada que lo
 * disparó.
 *
 * Vive fuera de la clase para poder probarlo: el mensaje llegó a decir
 * «Reading the image…» mientras se leía un texto pegado, y ningún test podía
 * verlo porque estaba incrustado en la plantilla.
 */
export function progressMessage(state: {
	preparing: boolean;
	downloading: boolean;
	uploading: boolean;
	on: WorkingOn;
}): string {
	if (state.downloading) {
		return msg("Downloading the AI model, this can take a few minutes…");
	}
	if (state.preparing) return msg("Getting the AI model ready…");
	if (state.uploading) return msg("Saving the image…");
	return state.on === "text"
		? msg("Reading your text and pulling out the event…")
		: msg("Reading the image and pulling out the event…");
}

/**
 * La segunda línea: por qué la espera merece la pena.
 *
 * El modelo corre en el dispositivo, así que ni el texto ni la foto salen de
 * aquí. Decirlo mientras se espera convierte un silencio incómodo en la razón
 * por la que tarda.
 */
export function progressHint(state: {
	downloading: boolean;
	uploading: boolean;
	onDevice: boolean;
}): string {
	if (state.downloading) {
		return msg("It only happens once. You can leave this open.");
	}
	// La portada **sí** sale del dispositivo: se guarda en tu cuenta. Prometer
	// aquí que no sale nada sería mentir justo en el momento en que deja de ser
	// verdad.
	if (state.uploading) return msg("The image is saved to your account.");
	return state.onDevice
		? msg("It runs on your device: nothing you wrote leaves it.")
		: msg("This can take a few seconds.");
}

/**
 * Qué decirle a quien está delante cuando algo falla.
 *
 * Los tres casos son distintos y llevan a acciones distintas: lo que ha pegado
 * no vale, no se ha podido sacar un evento, o la IA no está. Un único mensaje
 * para los tres obliga a adivinar qué hacer.
 *
 * `modelReady` decide el caso intermedio, y no es teoría: medido contra Gemini
 * Nano, un texto sin ningún evento —«Recuerda comprar leche y pilas»— hace que
 * el modelo **lance un error** en vez de contestar con el título vacío que se
 * le pide. Sin esto, ese texto anunciaba una avería de la IA.
 */
export function explainFailure(state: {
	cause: unknown;
	unreadable: string;
	modelReady: boolean;
}): string {
	if (state.cause instanceof TextInputError) {
		return state.cause.reason === "too-long"
			? msg(
					"That text is too long. Leave just the part that describes the event.",
				)
			: msg("Paste the text of the event first.");
	}

	if (state.cause instanceof GenerationError || state.modelReady) {
		return state.unreadable;
	}

	return msg(
		"Event generation is unavailable right now. You can still create the event by hand.",
	);
}

/** Lo que el generador entrega al editor. */
export interface GeneratedDraft {
	event: Partial<PlanuEvent>;
	/** Dónde se resolvió: útil para el usuario y para vigilar el gasto. */
	source: InferenceSourceName | undefined;
}

/**
 * Genera un evento a partir de la foto de un cartel o de un texto pegado.
 *
 * Usa Firebase AI Logic en modo híbrido: si el navegador trae IA integrada
 * corre en el dispositivo —gratis, sin red y sin que la imagen salga de aquí—;
 * si no, cae a Gemini en la nube. Lo que devuelva pasa siempre por el editor
 * para que el usuario lo revise: Gemini Nano se equivoca a menudo con fechas.
 *
 * Las dos entradas comparten modelo, esquema de respuesta y política de nube:
 * lo único que cambia es el prompt y, en la imagen, que el cartel se sube como
 * portada. Por eso el camino común vive en `#generate()` y cada entrada sólo
 * aporta cómo extraer y qué decir si el modelo no entiende nada.
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

		.working p {
			margin: 0;
		}

		.what {
			font-weight: var(--wa-font-weight-semibold);
		}

		.why {
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		.count {
			margin: 0;
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		.count[data-over] {
			color: var(--wa-color-danger-on-quiet);
		}

		.paste {
			display: flex;
			flex-direction: column;
			align-items: start;
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
	@state() private text = "";
	@state() private workingOn: WorkingOn = "image";
	@state() private busy = false;
	@state() private preparing = false;
	@state() private uploading = false;
	@state() private downloading = false;

	/**
	 * Si esta sesión se resuelve sin salir del dispositivo. Hoy siempre, por el
	 * candado de `ai-policy.ts`; se consulta en vez de darlo por hecho para que
	 * el aviso no mienta el día que se abra la nube.
	 *
	 * Arranca en `false` por lo mismo: el bloque de progreso se pinta ya durante
	 * la preparación, antes de que la política haya resuelto, y prometer
	 * privacidad en esa ventana sería afirmar algo que aún no se sabe.
	 */
	@state() private onDevice = false;
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
			this.text = "";
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

		this.preparing = true;
		try {
			await this.#warmup;
		} catch {
			// Silencio a propósito: el usuario todavía no ha pedido nada. Si
			// falla de verdad, lo sabrá al intentar generar, con su mensaje.
			this.#warmup = undefined;
		} finally {
			this.preparing = false;
		}
	}

	override render() {
		return html`
			<wa-dialog
				label=${msg("Generate event with AI")}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
				<p>
					${msg(
						"Upload a poster or flyer, or paste the text of an invitation, and the details will be filled in for you. You can review everything before saving.",
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
				</div>

				<wa-divider></wa-divider>

				<div class="paste">
					<!-- Sin \`maxlength\`, y no es un olvido: el atributo nativo
					     **recorta el pegado** sin decir nada, que es justo el
					     truncado silencioso que este tope venía a impedir. Quien
					     pega de más lo ve escrito y decide qué quitar. -->
					<wa-textarea
						label=${msg("Or paste the text of the event")}
						hint=${
							this.#tooLong
								? msg(
										"That text is too long. Leave just the part that describes the event.",
									)
								: msg(
										"An email, a message or an announcement. Nothing is saved until you review it.",
									)
						}
						rows="4"
						.withCount=${true}
						?disabled=${this.busy}
						.value=${this.text}
						@input=${this.#onText}
					></wa-textarea>
					<p class="count" ?data-over=${this.#tooLong}>
						${
							// El contador nativo de Web Awesome cuenta hacia atrás
							// desde `maxlength`, que ya no está; éste dice lo mismo
							// y además puede pasarse de la raya.
							msg(str`${this.text.trim().length} / ${MAX_TEXT_LENGTH}`)
						}
					</p>
					<wa-button
						variant="brand"
						?disabled=${this.busy || this.text.trim() === "" || this.#tooLong}
						@click=${this.#onGenerateText}
					>
						${msg("Generate from text")}
					</wa-button>
				</div>

				<!-- Un solo sitio para el estado, y el texto lo decide la entrada
				     que lo disparó. Estaba dentro del bloque de la imagen, así que
				     generar desde texto anunciaba que se estaba leyendo una foto. -->
				${
					this.busy || this.downloading || this.preparing
						? html`<div class="working">
								<wa-spinner></wa-spinner>
								<div>
									<p class="what">
										${progressMessage({
											preparing: this.preparing,
											downloading: this.downloading,
											uploading: this.uploading,
											on: this.workingOn,
										})}
									</p>
									<p class="why">
										${progressHint({
											downloading: this.downloading,
											uploading: this.uploading,
											onDevice: this.onDevice,
										})}
									</p>
								</div>
							</div>`
						: nothing
				}
				${
					this.uploading || this.downloading
						? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
						: nothing
				}

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

	/**
	 * Una sola instancia por sesión: el calentamiento y la generación comparten.
	 *
	 * Un rechazo **no** se queda memoizado. Si se guardase, un fallo pasajero al
	 * traer el SDK —es un import dinámico, basta la red floja— dejaría la IA
	 * muerta hasta recargar la página: cada reintento volvería a esperar el
	 * mismo rechazo. `#warmUp` ya se cura así; esto no lo hacía.
	 */
	#model() {
		this.#modelPromise ??= this.#buildModel().catch((cause: unknown) => {
			this.#modelPromise = undefined;
			throw cause;
		});
		return this.#modelPromise;
	}

	#revokePreview(): void {
		if (this.preview.startsWith("blob:")) URL.revokeObjectURL(this.preview);
	}

	async #onFile(domEvent: globalThis.Event): Promise<void> {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !this.app) return;

		this.#revokePreview();
		this.preview = URL.createObjectURL(file);

		try {
			await this.#generate({
				on: "image",
				extract: (generate) => generateEventFromImage(generate, file),
				// El cartel del que se extrajo el evento es su portada natural.
				cover: file,
				unreadable: msg(
					"The image could not be read as an event. Try a clearer photo.",
				),
			});
		} finally {
			// Sin esto, elegir dos veces la misma foto no dispara `change` y el
			// segundo intento parecería que no hace nada.
			input.value = "";
		}
	}

	/** Si lo pegado se pasa del tope. `generate-from-text.ts` lo vuelve a mirar. */
	get #tooLong(): boolean {
		return this.text.trim().length > MAX_TEXT_LENGTH;
	}

	#onText(domEvent: globalThis.Event): void {
		const source = domEvent.composedPath()[0] as HTMLInputElement | undefined;
		this.text = source?.value ?? "";
	}

	async #onGenerateText(): Promise<void> {
		if (!this.app) return;

		await this.#generate({
			on: "text",
			extract: (generate) => generateEventFromText(generate, this.text),
			unreadable: msg(
				"No event could be found in that text. Add the date and the place, or create the event by hand.",
			),
		});
	}

	/**
	 * El camino común de las dos entradas: prepara el modelo, extrae, y entrega
	 * el borrador al editor.
	 *
	 * Ningún fallo de aquí deja al usuario sin salida: se queda en el diálogo con
	 * el motivo escrito y el alta manual intacta detrás.
	 */
	async #generate({
		on,
		extract,
		cover,
		unreadable,
	}: {
		on: WorkingOn;
		extract: (generate: GenerateContent) => Promise<GeneratedEvent>;
		cover?: File;
		unreadable: string;
	}): Promise<void> {
		const token = this.#generation;
		this.error = "";
		this.workingOn = on;
		this.busy = true;

		try {
			// El modelo ya se estaba preparando desde que se abrió el diálogo;
			// aquí sólo se espera a que termine si aún no lo ha hecho.
			await this.#warmUp();
			const model = await this.#model();

			let source: InferenceSourceName | undefined;
			const generated = await extract(async (parts) => {
				const result = await model.generateContent({
					contents: [{ role: "user", parts }],
				});
				// El SDK dice dónde acabó ejecutándose; es la única forma fiable
				// de saberlo, porque el modo sólo expresa una preferencia.
				source = result.response.inferenceSource as
					| InferenceSourceName
					| undefined;
				return result.response.text();
			});

			// Si el usuario canceló mientras el modelo pensaba, aquí se para: ni
			// se sube la imagen ni se reabre el editor a su espalda.
			if (token !== this.#generation) return;

			// La portada se sube después de generar, no antes, para no dejar en
			// Storage las imágenes de los intentos que no llegan a nada.
			const imageUrl = cover ? await this.#uploadCover(cover) : "";

			// Otra vez, porque subir la portada tarda: sin esto, cancelar durante
			// la subida terminaba de subir y reabría el editor a su espalda.
			if (token !== this.#generation) return;

			this.#emit({
				event: imageUrl ? { ...generated, imageUrl } : generated,
				source,
			});
			this.#close();
		} catch (cause) {
			if (token !== this.#generation) return;
			this.error = explainFailure({
				cause,
				unreadable,
				modelReady: this.availability === "available",
			});
		} finally {
			// Sólo apaga las luces quien las encendió. Sin esta guarda, una
			// generación cancelada que resolvía tarde apagaba el aviso de la que
			// estaba en curso y rehabilitaba sus campos a mitad de vuelo.
			if (token === this.#generation) {
				this.busy = false;
				this.preparing = false;
				this.downloading = false;
			}
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

		const mode = resolveInferenceMode({ cloudEnabled, premium });
		// Lo que se le promete al usuario mientras espera sale de aquí, no de
		// una suposición escrita en la plantilla.
		this.onDevice = mode === "only_on_device";
		return mode;
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
		// Y se olvida lo que había: cancelar durante una generación lenta dejaba
		// `busy` encendido, así que al reabrir el diálogo salía con el campo, el
		// selector y el botón deshabilitados y un aviso de la vez anterior. La
		// única salida era esperar a una llamada que quizá no volvía nunca.
		this.preview = "";
		this.busy = false;
		this.preparing = false;
		this.uploading = false;
		this.downloading = false;
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-generator-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-ai-event-generator": PlanuAiEventGenerator;
	}
}
