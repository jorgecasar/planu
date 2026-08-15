import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";

import { consume } from "@lit/context";
import type { User } from "firebase/auth";
import {
	addDoc,
	collection,
	doc,
	type Firestore,
	setDoc,
	Timestamp,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	firestoreContext,
	storageContext,
	userContext,
} from "../firebase/context.js";
import { uploadFile } from "../firebase/storage.js";
import { EventSchema, type PlanuEvent, type StoredEvent } from "../lib/types.js";

/** Coincide con el tope de storage.rules; comprobarlo aquí da mejor mensaje. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Un input date espera y devuelve YYYY-MM-DD. */
const toInputDate = (date: Date | null | undefined): string =>
	date ? date.toISOString().slice(0, 10) : "";

@customElement("planu-event-editor")
export class PlanuEventEditor extends LitElement {
	static override styles = css`
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

		img {
			inline-size: 100%;
			block-size: 10rem;
			object-fit: cover;
			border-radius: var(--wa-border-radius-m);
		}
	`;

	@property({ type: Boolean }) open = false;

	/** Presente en modo edición. */
	@property({ attribute: false }) event: StoredEvent | undefined;

	/** Valores propuestos por la IA para prerrellenar un alta. */
	@property({ attribute: false }) draft: Partial<PlanuEvent> | undefined;

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

	override willUpdate(changed: Map<string, unknown>): void {
		// Al abrirse, el formulario parte de lo que se está editando o de lo que
		// propuso la IA. Sin esto el diálogo conservaría lo de la vez anterior.
		if (changed.has("open") && this.open) {
			this.imageUrl = this.draft?.imageUrl ?? this.event?.imageUrl ?? "";
			this.error = "";
			this.progress = 0;
		}
	}

	override render() {
		const initial = { ...this.event, ...this.draft };
		const editing = this.event !== undefined;

		return html`
			<wa-dialog
				label=${editing ? "Edit event" : "New event"}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}

				${this.open ? this.#renderForm(initial) : nothing}

				<wa-button slot="footer" appearance="outlined" @click=${this.#close}>
					Cancel
				</wa-button>
				<wa-button
					slot="footer"
					variant="brand"
					type="submit"
					form="event-form"
					?disabled=${this.saving || this.uploading}
				>
					${this.saving ? "Saving…" : "Save event"}
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
						<label for="cover">Cover image</label>
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
										Remove image
									</wa-button>`
								: nothing
						}
					</div>

					<wa-input
						name="title"
						label="Title"
						required
						minlength="3"
						enterkeyhint="next"
						.value=${initial.title ?? ""}
					></wa-input>

					<wa-textarea
						name="description"
						label="Description"
						.value=${initial.description ?? ""}
					></wa-textarea>

					<wa-input
						name="location"
						label="Location"
						enterkeyhint="next"
						.value=${initial.location ?? ""}
					></wa-input>

					<div class="dates">
						<wa-input
							type="date"
							name="startDate"
							label="Start date"
							.value=${toInputDate(initial.startDate)}
						></wa-input>
						<wa-input
							type="date"
							name="endDate"
							label="End date"
							enterkeyhint="done"
							.value=${toInputDate(initial.endDate)}
						></wa-input>
					</div>
				</form>
		`;
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
			this.error = "Images must be smaller than 5 MB.";
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
			this.error = "The image could not be uploaded. Please try again.";
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

		const parsed = EventSchema.safeParse({
			title: text("title"),
			description: text("description"),
			location: text("location"),
			startDate: date("startDate"),
			endDate: date("endDate"),
			imageUrl: this.imageUrl,
			userId: user.uid,
		});

		if (!parsed.success) {
			this.error = parsed.error.issues[0]?.message ?? "Check the form.";
			return;
		}

		this.saving = true;
		try {
			await this.#save(firestore, user, parsed.data);
			this.#close();
		} catch {
			this.error = "The event could not be saved. Please try again.";
		} finally {
			this.saving = false;
		}
	}

	#save(firestore: Firestore, user: User, values: PlanuEvent): Promise<unknown> {
		const document = {
			title: values.title,
			description: values.description ?? "",
			location: values.location ?? "",
			imageUrl: values.imageUrl ?? "",
			// Siempre el uid de la sesión: las reglas rechazan cualquier otro.
			userId: user.uid,
			startDate: values.startDate ? Timestamp.fromDate(values.startDate) : null,
			endDate: values.endDate ? Timestamp.fromDate(values.endDate) : null,
		};

		return this.event
			? setDoc(doc(firestore, "events", this.event.id), document, { merge: true })
			: addDoc(collection(firestore, "events"), document);
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
