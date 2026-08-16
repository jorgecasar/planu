import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/icon/icon.js";
import "@awesome.me/webawesome/dist/components/tag/tag.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import type { User } from "firebase/auth";
import {
	addDoc,
	collection,
	doc,
	type Firestore,
	serverTimestamp,
	setDoc,
	Timestamp,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	describeInferenceSource,
	type InferenceSourceName,
} from "../domain/ai-policy.js";
import { toInputDate } from "../domain/format-dates.js";
import {
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTag,
	normalizeTags,
	suggestTags,
	tagHue,
} from "../domain/tags.js";
import {
	firestoreContext,
	storageContext,
	userContext,
} from "../firebase/context.js";
import { uploadFile } from "../firebase/storage.js";
import {
	eventSchema,
	type PlanuEvent,
	type StoredEvent,
} from "../lib/types.js";
import { tagChipStyles } from "./tag-styles.js";

/** Coincide con el tope de storage.rules; comprobarlo aquí da mejor mensaje. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

@customElement("planu-event-editor")
export class PlanuEventEditor extends LitElement {
	static override styles = [
		tagChipStyles,
		css`
		form {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-m);
		}

		.dates {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-m);
		}

		.dates > * {
			flex: 1 1 10rem;
		}

		.cover {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-xs);
		}

		.tags {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-xs);
		}

		.tags ul {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-2xs);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		/* El botón de borrado que trae wa-tag sale con tabindex -1, así que
		   quien navega con teclado no puede retirar una etiqueta puesta por
		   error. Va un control propio al lado, alcanzable con Tab. */
		.tags .chosen li {
			display: flex;
			align-items: center;
			gap: var(--wa-space-3xs);
		}

		img {
			inline-size: 100%;
			block-size: 10rem;
			object-fit: cover;
			border-radius: var(--wa-border-radius-m);
		}
		`,
	];

	@property({ type: Boolean }) open = false;

	/** Presente en modo edición. */
	@property({ attribute: false }) event: StoredEvent | undefined;

	/** Valores propuestos por la IA para prerrellenar un alta. */
	@property({ attribute: false }) draft: Partial<PlanuEvent> | undefined;

	/** Dónde se resolvió la generación, para decírselo al usuario. */
	@property({ attribute: false }) draftSource: InferenceSourceName | undefined;

	@consume({ context: firestoreContext, subscribe: true })
	private firestore: Firestore | undefined;

	@consume({ context: storageContext, subscribe: true })
	private storage: FirebaseStorage | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: User | null | undefined;

	@state() private imageUrl = "";
	@state() private uploading = false;
	@state() private progress = 0;
	@state() private saving = false;
	@state() private error = "";

	/** Etiquetas ya puestas en este evento, siempre normalizadas. */
	@state() private tags: string[] = [];

	/** Lo que se está tecleando en el campo de etiqueta. */
	@state() private tagDraft = "";

	/** Las que el usuario ya usa en otros eventos, para el autocompletado. */
	@property({ attribute: false }) knownTags: readonly string[] = [];

	override willUpdate(changed: Map<string, unknown>): void {
		// Al abrirse, el formulario parte de lo que se está editando o de lo que
		// propuso la IA. Sin esto el diálogo conservaría lo de la vez anterior.
		//
		// También si cambia el evento o el borrador con el diálogo ya abierto.
		// Hoy no hay ruta que lo provoque —`editing` y `draft` sólo se tocan al
		// abrir y al cerrar— así que no arregla ningún fallo vivo; cierra la
		// trampa de que la primera que aparezca reabra el editor con las
		// etiquetas del evento anterior y sin aviso.
		if (
			(changed.has("open") || changed.has("event") || changed.has("draft")) &&
			this.open
		) {
			this.imageUrl = this.draft?.imageUrl ?? this.event?.imageUrl ?? "";
			this.tags = normalizeTags(this.draft?.tags ?? this.event?.tags ?? []);
			this.tagDraft = "";
			this.error = "";
			this.progress = 0;
		}
	}

	override render() {
		const initial = { ...this.event, ...this.draft };
		const editing = this.event !== undefined;

		return html`
			<wa-dialog
				label=${editing ? msg("Edit event") : msg("New event")}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}

				${
					this.draft && this.open
						? html`<wa-callout variant="neutral">
								${describeInferenceSource(this.draftSource)}.
								${msg("Review the details before saving.")}
							</wa-callout>`
						: nothing
				}

				${this.open ? this.#renderForm(initial) : nothing}

				<wa-button slot="footer" appearance="outlined" @click=${this.#close}>
					${msg("Cancel")}
				</wa-button>
				<wa-button
					slot="footer"
					variant="brand"
					type="submit"
					form="event-form"
					?disabled=${this.saving || this.uploading}
				>
					${this.saving ? msg("Saving…") : msg("Save event")}
				</wa-button>
			</wa-dialog>
		`;
	}

	/**
	 * El formulario se crea de nuevo en cada apertura.
	 *
	 * Lit sólo reescribe una propiedad cuando cambia respecto a lo que él
	 * commiteó, y no se entera de lo que teclea el usuario. Manteniendo el
	 * formulario en el DOM, reabrir el editor mostraría los valores del evento
	 * anterior.
	 */
	#renderForm(initial: Partial<PlanuEvent>) {
		return html`
			<form id="event-form" @submit=${this.#onSubmit}>
					<div class="cover">
						<label for="cover">${msg("Cover image")}</label>
						${this.imageUrl ? html`<img src=${this.imageUrl} alt="" />` : nothing}
						<input
							id="cover"
							type="file"
							accept="image/*"
							?disabled=${this.uploading}
							@change=${this.#onFile}
						/>
						${
							this.uploading
								? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
								: nothing
						}
						${
							this.imageUrl
								? html`<wa-button
										type="button"
										appearance="plain"
										@click=${this.#removeImage}
									>
										${msg("Remove image")}
									</wa-button>`
								: nothing
						}
					</div>

					<wa-input
						name="title"
						label=${msg("Title")}
						required
						minlength="3"
						enterkeyhint="next"
						.value=${initial.title ?? ""}
					></wa-input>

					<wa-textarea
						name="description"
						label=${msg("Description")}
						.value=${initial.description ?? ""}
					></wa-textarea>

					<wa-input
						name="location"
						label=${msg("Location")}
						enterkeyhint="next"
						.value=${initial.location ?? ""}
					></wa-input>

					${this.#renderTags()}

					<div class="dates">
						<wa-input
							type="date"
							name="startDate"
							label=${msg("Start date")}
							.value=${toInputDate(initial.startDate)}
						></wa-input>
						<wa-input
							type="date"
							name="endDate"
							label=${msg("End date")}
							enterkeyhint="done"
							.value=${toInputDate(initial.endDate)}
						></wa-input>
					</div>
				</form>
		`;
	}

	/**
	 * Campo de etiquetas: las puestas, lo que se teclea y las sugerencias.
	 *
	 * Las sugerencias son botones y no un `datalist`: `wa-input` renderiza su
	 * `input` dentro del shadow DOM, así que un `<datalist>` de fuera no lo
	 * alcanza. Botones funcionan con teclado y con lector de pantalla sin
	 * inventarse un combobox a mano.
	 */
	#renderTags() {
		const suggestions = suggestTags(this.knownTags, this.tagDraft, this.tags);
		const full = this.tags.length >= MAX_TAGS;

		return html`
			<div class="tags">
				<wa-input
					id="tag"
					label=${msg("Tags")}
					hint=${msg(str`Press Enter to add. Up to ${MAX_TAGS}.`)}
					maxlength=${MAX_TAG_LENGTH}
					enterkeyhint="enter"
					?disabled=${full}
					.value=${this.tagDraft}
					@input=${this.#onTagInput}
					@keydown=${this.#onTagKey}
				></wa-input>

				${this.#renderTagList(
					"chosen",
					msg("Chosen tags"),
					this.tags,
					(tag) =>
						html`
						<wa-tag size="small" style=${`--hue: ${tagHue(tag)}`}>${tag}</wa-tag>
						<wa-button
							type="button"
							size="small"
							appearance="plain"
							@click=${() => this.#removeTag(tag)}
						>
							<wa-icon name="xmark" label=${msg(str`Remove tag ${tag}`)}></wa-icon>
						</wa-button>
					`,
				)}

				${
					full
						? nothing
						: this.#renderTagList(
								"suggestions",
								msg("Suggested tags"),
								suggestions,
								(tag) => html`
									<wa-button
										type="button"
										size="small"
										appearance="outlined"
										@click=${() => this.#addTag(tag)}
									>${tag}</wa-button>
								`,
							)
				}
			</div>
		`;
	}

	/**
	 * Una lista de etiquetas con nombre accesible, o nada si está vacía.
	 *
	 * Las puestas y las sugeridas son la misma estructura con distinto
	 * contenido; tenerlas por duplicado era la forma segura de que una ganase
	 * un `aria-label` y la otra no.
	 *
	 * El contenido se tipa con el `TemplateResult` que exporta lit y no con
	 * `unknown`: `unknown` admite una función que devuelva `void` o una promesa,
	 * y las dos compilan y pintan `undefined` o `[object Promise]` sin que nadie
	 * se entere.
	 */
	#renderTagList(
		className: string,
		label: string,
		tags: readonly string[],
		content: (tag: string) => TemplateResult,
	) {
		if (tags.length === 0) return nothing;

		return html`<ul class=${className} aria-label=${label}>
			${tags.map((tag) => html`<li>${content(tag)}</li>`)}
		</ul>`;
	}

	#onTagInput(domEvent: globalThis.Event): void {
		const source = domEvent.composedPath()[0] as HTMLInputElement | undefined;
		this.tagDraft = source?.value ?? "";
	}

	/**
	 * Enter añade la etiqueta en vez de enviar el formulario.
	 *
	 * Sin el `preventDefault` el editor se guardaría a medio escribir cada vez
	 * que alguien confirma una etiqueta, que es justo el gesto natural.
	 *
	 * La coma **no** separa, aunque sea la costumbre. Una etiqueta puede
	 * llevarla —`normalizeTag` la conserva y las reglas la aceptan, que es
	 * justo por lo que el separador de allí es el salto de línea— así que
	 * tratarla como separador prohibiría en silencio un valor que las otras dos
	 * capas dan por bueno. Y el campo sólo anuncia Intro.
	 */
	#onTagKey(domEvent: KeyboardEvent): void {
		if (domEvent.key !== "Enter") return;
		domEvent.preventDefault();
		this.#addTag(this.tagDraft);
	}

	/**
	 * El aviso de longitud, en un único sitio.
	 *
	 * Se pone y se retira comparándolo, porque `error` es el canal de todo el
	 * diálogo: retirarlo a ciegas al añadir una etiqueta borraba también «The
	 * image could not be uploaded», y el usuario perdía un aviso sobre algo que
	 * no había hecho nada por resolver.
	 */
	#tagLengthError(): string {
		return msg(str`A tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
	}

	#addTag(raw: string): void {
		const tag = normalizeTag(raw);
		if (tag === null) {
			// Sólo se avisa si había algo que añadir: un Enter sobre el campo
			// vacío es un gesto, no un error.
			if (raw.trim() !== "") {
				this.error = this.#tagLengthError();
			}
			return;
		}
		if (this.tags.includes(tag) || this.tags.length >= MAX_TAGS) {
			this.tagDraft = "";
			return;
		}
		this.tags = [...this.tags, tag];
		this.tagDraft = "";
		if (this.error === this.#tagLengthError()) this.error = "";
	}

	#removeTag(tag: string): void {
		this.tags = this.tags.filter((each) => each !== tag);
	}

	async #onFile(domEvent: globalThis.Event): Promise<void> {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const { storage, user } = this;
		if (!storage || !user) return;

		// Las reglas rechazarían el fichero igualmente, pero con un error de
		// permisos que no explica nada al usuario.
		if (file.size >= MAX_IMAGE_BYTES) {
			this.error = msg("Images must be smaller than 5 MB.");
			input.value = "";
			return;
		}

		this.error = "";
		this.uploading = true;
		this.progress = 0;
		try {
			this.imageUrl = await uploadFile(
				storage,
				file,
				`events/${user.uid}`,
				(percent) => {
					this.progress = percent;
				},
			);
		} catch {
			this.error = msg("The image could not be uploaded. Please try again.");
		} finally {
			this.uploading = false;
			input.value = "";
		}
	}

	#removeImage(): void {
		this.imageUrl = "";
	}

	async #onSubmit(domEvent: SubmitEvent): Promise<void> {
		domEvent.preventDefault();

		const { firestore, user } = this;
		if (!firestore || !user) return;

		const data = new FormData(domEvent.target as HTMLFormElement);
		const text = (key: string) => String(data.get(key) ?? "").trim();
		const date = (key: string) => {
			const value = text(key);
			return value === "" ? null : new Date(`${value}T00:00:00`);
		};

		const parsed = eventSchema().safeParse({
			title: text("title"),
			description: text("description"),
			location: text("location"),
			startDate: date("startDate"),
			endDate: date("endDate"),
			imageUrl: this.imageUrl,
			userId: user.uid,
			tags: this.tags,
		});

		if (!parsed.success) {
			this.error = parsed.error.issues[0]?.message ?? msg("Check the form.");
			return;
		}

		this.saving = true;
		try {
			await this.#save(firestore, user, parsed.data);
			this.#close();
		} catch {
			this.error = msg("The event could not be saved. Please try again.");
		} finally {
			this.saving = false;
		}
	}

	#save(
		firestore: Firestore,
		user: User,
		values: PlanuEvent,
	): Promise<unknown> {
		const content = {
			title: values.title,
			description: values.description ?? "",
			location: values.location ?? "",
			imageUrl: values.imageUrl ?? "",
			startDate: values.startDate ? Timestamp.fromDate(values.startDate) : null,
			endDate: values.endDate ? Timestamp.fromDate(values.endDate) : null,
			tags: values.tags,
		};

		// Editing sends content only. Resending the editor's uid would cost an
		// invited editor their permission, because to the rules that is
		// transferring ownership; and membership is not touched from here, which
		// is what the share dialog is for.
		if (this.event) {
			return setDoc(doc(firestore, "events", this.event.id), content, {
				merge: true,
			});
		}

		// An event is born with its creator as sole member and no guests: the
		// rules reject any other way of starting.
		return addDoc(collection(firestore, "events"), {
			...content,
			userId: user.uid,
			memberIds: [user.uid],
			roles: {},
			createdAt: serverTimestamp(),
		});
	}

	#close(): void {
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-editor-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-editor": PlanuEventEditor;
	}
}
