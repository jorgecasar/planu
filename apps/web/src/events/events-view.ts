import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/skeleton/skeleton.js";
import "./ai-event-generator.js";
import "./event-card.js";
import "./event-editor.js";
import "./event-filters.js";

import { consume } from "@lit/context";
import type { User } from "firebase/auth";
import {
	collection,
	type DocumentData,
	type Firestore,
	query,
	Timestamp,
	where,
} from "firebase/firestore";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { CollectionController } from "../firebase/collection-controller.js";
import { firestoreContext, userContext } from "../firebase/context.js";
import type { PlanuEvent, StoredEvent } from "../lib/types.js";
import type { FiltersChange } from "./event-filters.js";
import { type DateRange, filterEvents } from "./filter-events.js";

/** Firestore guarda las fechas como Timestamp; la aplicación trabaja con Date. */
function toEvent(document: DocumentData & { id: string }): StoredEvent {
	const asDate = (value: unknown) =>
		value instanceof Timestamp ? value.toDate() : null;

	return {
		id: document["id"],
		title: String(document["title"] ?? ""),
		description: document["description"] as string | undefined,
		location: document["location"] as string | undefined,
		imageUrl: document["imageUrl"] as string | undefined,
		userId: document["userId"] as string | undefined,
		startDate: asDate(document["startDate"]),
		endDate: asDate(document["endDate"]),
	};
}

/** Listado de los eventos del usuario, con búsqueda y filtro por fechas. */
@customElement("planu-events-view")
export class PlanuEventsView extends LitElement {
	static override styles = css`
		:host {
			display: block;
			padding: var(--wa-space-l);
		}

		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
			gap: var(--wa-space-l);
			margin-block-start: var(--wa-space-l);
		}

		.toolbar {
			display: flex;
			flex-wrap: wrap;
			align-items: end;
			justify-content: space-between;
			gap: var(--wa-space-m);
		}

		planu-event-filters {
			flex: 1 1 24rem;
		}

		.empty {
			margin-block-start: var(--wa-space-2xl);
			text-align: center;
			color: var(--wa-color-text-quiet);
		}
	`;

	@consume({ context: firestoreContext, subscribe: true })
	private firestore: Firestore | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: User | null | undefined;

	@state() private searchTerm = "";
	@state() private range: DateRange = {};
	@state() private editorOpen = false;
	@state() private editing: StoredEvent | undefined;
	@state() private generatorOpen = false;
	@state() private draft: Partial<PlanuEvent> | undefined;

	readonly #events = new CollectionController<DocumentData>(this);

	constructor() {
		super();
		// La tarjeta no conoce al editor: emite y esta vista decide.
		this.addEventListener("planu-edit-event", (domEvent) => {
			this.editing = (domEvent as CustomEvent<StoredEvent>).detail;
			this.editorOpen = true;
		});
	}

	/** Entradas de las que depende la consulta; sólo se rehace si cambian. */
	#queryKey: string | undefined;

	override willUpdate(): void {
		const { firestore, user } = this;
		const key = firestore && user ? user.uid : "";

		// Reconstruir la consulta en cada actualización dispara una
		// resuscripción, que provoca un snapshot, que provoca otra
		// actualización: un bucle que reescribe el DOM varias veces por segundo.
		if (key === this.#queryKey) return;
		this.#queryKey = key;

		this.#events.setQuery(
			firestore && user
				? query(
						collection(firestore, "events"),
						where("userId", "==", user.uid),
					)
				: null,
		);
	}

	override render() {
		const all = this.#events.data.map(toEvent);
		const visible = filterEvents(all, this.searchTerm, this.range);

		return html`
			<div class="toolbar">
				<planu-event-filters
					@planu-filters-change=${this.#onFilters}
				></planu-event-filters>
				<wa-dropdown @wa-select=${this.#onCreateOption}>
					<wa-button slot="trigger" variant="brand" .withCaret=${true}>
						New event
					</wa-button>
					<wa-dropdown-item value="manual">Create manually</wa-dropdown-item>
					<wa-dropdown-item value="ai">Generate from an image</wa-dropdown-item>
				</wa-dropdown>
			</div>

			${this.#renderList(all.length, visible)}

			<planu-event-editor
				.open=${this.editorOpen}
				.event=${this.editing}
				.draft=${this.draft}
				@planu-editor-close=${this.#onEditorClose}
			></planu-event-editor>

			<planu-ai-event-generator
				.open=${this.generatorOpen}
				@planu-event-generated=${this.#onGenerated}
				@planu-generator-close=${this.#onGeneratorClose}
			></planu-ai-event-generator>
		`;
	}

	#onCreateOption(domEvent: Event): void {
		const value = (domEvent as CustomEvent<{ item: { value: string } }>).detail
			.item.value;
		if (value === "ai") {
			this.generatorOpen = true;
			return;
		}
		this.#onNew();
	}

	/** Lo extraído por la IA no se guarda: prerrellena el editor para revisarlo. */
	#onGenerated(domEvent: Event): void {
		this.draft = (domEvent as CustomEvent<Partial<PlanuEvent>>).detail;
		this.editing = undefined;
		this.generatorOpen = false;
		this.editorOpen = true;
	}

	#onGeneratorClose(): void {
		this.generatorOpen = false;
	}

	#onEditorClose(): void {
		this.editorOpen = false;
		this.editing = undefined;
	}

	#renderList(total: number, visible: StoredEvent[]) {
		if (this.#events.loading) return this.#renderSkeletons();
		if (visible.length === 0) return this.#renderEmpty(total);

		return html`<div class="grid">
			${visible.map(
				(event) => html`<planu-event-card .event=${event}></planu-event-card>`,
			)}
		</div>`;
	}

	#renderSkeletons() {
		return html`<div class="grid">
			${Array.from(
				{ length: 6 },
				() => html`<wa-skeleton style="height: 12rem"></wa-skeleton>`,
			)}
		</div>`;
	}

	/**
	 * "No tienes eventos" y "tu búsqueda no encuentra nada" son problemas
	 * distintos y la salida de cada uno también.
	 */
	#renderEmpty(total: number) {
		return html`<div class="empty">
			${
				total > 0
					? html`<p>No events match your search or date filter.</p>`
					: html`
							<p>You have no events yet.</p>
							<wa-button variant="brand" @click=${this.#onNew}>
								Create your first event
							</wa-button>
						`
			}
		</div>`;
	}

	#onFilters(event: Event): void {
		const detail = (event as CustomEvent<FiltersChange>).detail;
		this.searchTerm = detail.searchTerm;
		this.range = { from: detail.from, to: detail.to };
	}

	#onNew(): void {
		this.editing = undefined;
		this.editorOpen = true;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-events-view": PlanuEventsView;
	}
}
