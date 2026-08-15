import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { deleteDoc, doc, type Firestore } from "firebase/firestore";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { firestoreContext } from "../firebase/context.js";
import type { StoredEvent } from "../lib/types.js";
import { formatEventDates } from "./format-dates.js";

/** Tarjeta de un evento, con acciones de editar y borrar. */
@customElement("planu-event-card")
export class PlanuEventCard extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		/* h2 y no h3: el único encabezado por encima es el h1 de la cabecera,
		   y saltarse un nivel es una violación de accesibilidad. */
		h2 {
			margin: 0;
			font-size: var(--wa-font-size-l);
		}

		img {
			inline-size: 100%;
			block-size: 10rem;
			object-fit: cover;
		}

		p {
			margin: 0 0 var(--wa-space-s);
		}

		/* No es una lista de definiciones: son dos líneas de metadatos. Un <dl>
		   con <div> que no contienen dt/dd es inválido y axe lo marca. */
		.meta {
			display: grid;
			gap: var(--wa-space-2xs);
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}
	`;

	@property({ attribute: false }) event!: StoredEvent;

	@consume({ context: firestoreContext, subscribe: true })
	private firestore: Firestore | undefined;

	@state() private confirming = false;
	@state() private deleting = false;
	@state() private error = "";

	override render() {
		const { event } = this;
		return html`
			<wa-card>
				${
					event.imageUrl
						? html`<img slot="media" src=${event.imageUrl} alt="" />`
						: nothing
				}

				<h2 slot="header">${event.title}</h2>

				${event.description ? html`<p>${event.description}</p>` : nothing}

				<div class="meta">
					${event.location ? html`<span>${event.location}</span>` : nothing}
					<span>${formatEventDates(event.startDate, event.endDate)}</span>
				</div>

				<wa-button slot="footer" appearance="plain" @click=${this.#onEdit}>
					${msg("Edit")}
				</wa-button>
				<wa-button
					slot="footer"
					appearance="plain"
					variant="danger"
					@click=${this.#askDelete}
				>
					${msg("Delete")}
				</wa-button>
			</wa-card>

			<wa-dialog
				label=${msg("Delete event")}
				.open=${this.confirming}
				@wa-hide=${this.#cancelDelete}
			>
				<p>${msg(str`This permanently deletes “${event.title}”. It cannot be undone.`)}</p>
				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}
				<wa-button slot="footer" appearance="outlined" @click=${this.#cancelDelete}>
					${msg("Cancel")}
				</wa-button>
				<wa-button
					slot="footer"
					variant="danger"
					?disabled=${this.deleting}
					@click=${this.#confirmDelete}
				>
					${this.deleting ? msg("Deleting…") : msg("Delete")}
				</wa-button>
			</wa-dialog>
		`;
	}

	#onEdit(): void {
		this.dispatchEvent(
			new CustomEvent("planu-edit-event", {
				detail: this.event,
				bubbles: true,
				composed: true,
			}),
		);
	}

	#askDelete(): void {
		this.confirming = true;
	}

	#cancelDelete(): void {
		this.confirming = false;
	}

	async #confirmDelete(): Promise<void> {
		if (!this.firestore) return;

		this.deleting = true;
		this.error = "";
		try {
			await deleteDoc(doc(this.firestore, "events", this.event.id));
			this.confirming = false;
		} catch {
			// Sin este catch la promesa se rechazaba sin manejar: el diálogo se
			// quedaba abierto, el spinner paraba y el usuario no sabía por qué
			// no pasaba nada.
			this.error = msg("The event could not be deleted. Please try again.");
		} finally {
			this.deleting = false;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-card": PlanuEventCard;
	}
}
