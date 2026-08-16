import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/skeleton/skeleton.js";
import "./ai-event-generator.js";
import "./event-card.js";
import { canOffer, checkAvailability } from "./ai-availability.js";
import type { GeneratedDraft } from "./ai-event-generator.js";
import type { InferenceSourceName } from "./ai-policy.js";
import "./event-editor.js";
import "./event-filters.js";
import "../sharing/invitations-inbox.js";

import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import type { User } from "firebase/auth";
import {
	collection,
	type DocumentData,
	type Firestore,
	query,
	Timestamp,
	where,
} from "firebase/firestore";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { CollectionController } from "../firebase/collection-controller.js";
import { firestoreContext, userContext } from "../firebase/context.js";
import {
	eventSchema,
	type PlanuEvent,
	type StoredEvent,
} from "../lib/types.js";
import type { FiltersChange } from "./event-filters.js";
import {
	type DateRange,
	filterEvents,
	type OwnershipFilter,
} from "./filter-events.js";

/**
 * Convierte un documento de Firestore en un evento, validándolo.
 *
 * Las reglas ya exigen tipos, pero el cliente no debe confiar en que un
 * documento cumpla: los heredados del prototipo no pasaron por ellas. Sin
 * validar, un `description` numérico hacía estallar `.toLowerCase()` dentro de
 * `render()`, y Lit no captura eso: rompía el listado entero, no una tarjeta.
 *
 * Devuelve `null` para lo que no encaje, que se descarta.
 */
function toEvent(document: DocumentData & { id: string }): StoredEvent | null {
	const asDate = (value: unknown) =>
		value instanceof Timestamp ? value.toDate() : null;

	const parsed = eventSchema().safeParse({
		title: document["title"],
		description: document["description"],
		location: document["location"],
		imageUrl: document["imageUrl"],
		userId: document["userId"],
		memberIds: document["memberIds"],
		roles: document["roles"],
		startDate: asDate(document["startDate"]),
		endDate: asDate(document["endDate"]),
		createdAt: asDate(document["createdAt"]),
	});

	if (!parsed.success) {
		console.warn("Evento descartado por no validar:", document["id"]);
		return null;
	}

	return { ...parsed.data, id: document["id"] };
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
	@state() private ownership: OwnershipFilter = "all";
	@state() private editorOpen = false;
	@state() private editing: StoredEvent | undefined;
	@state() private generatorOpen = false;
	@state() private draft: Partial<PlanuEvent> | undefined;
	@state() private draftSource: InferenceSourceName | undefined;
	@state() private aiAvailable = false;

	readonly #events = new CollectionController<DocumentData>(this);

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		// Un botón que siempre falla es peor que un botón que no está.
		this.aiAvailable = canOffer(await checkAvailability());
	}

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
		// Firestore llega después que el usuario, porque se carga bajo demanda:
		// si la clave sólo mirase el uid, la consulta no se crearía nunca.
		const key = firestore && user ? `${user.uid}:ready` : "";

		// Reconstruir la consulta en cada actualización dispara una
		// resuscripción, que provoca un snapshot, que provoca otra
		// actualización: un bucle que reescribe el DOM varias veces por segundo.
		if (key === this.#queryKey) return;
		this.#queryKey = key;

		this.#events.setQuery(
			firestore && user
				? query(
						collection(firestore, "events"),
						// By membership rather than ownership, so events other people
						// shared arrive too. The rules deny every other way of
						// querying this collection, filtering by `userId` included.
						where("memberIds", "array-contains", user.uid),
					)
				: null,
		);
	}

	override render() {
		const all = this.#events.data
			.map(toEvent)
			.filter((event): event is StoredEvent => event !== null);
		const visible = filterEvents(
			all,
			this.searchTerm,
			this.range,
			this.ownership,
			this.user?.uid ?? "",
		);

		return html`
			<planu-invitations-inbox></planu-invitations-inbox>

			<div class="toolbar">
				<planu-event-filters
					@planu-filters-change=${this.#onFilters}
				></planu-event-filters>
				<wa-dropdown @wa-select=${this.#onCreateOption}>
					<wa-button slot="trigger" variant="brand" .withCaret=${true}>
						${msg("New event")}
					</wa-button>
					<wa-dropdown-item value="manual">${msg("Create manually")}</wa-dropdown-item>
					${
						this.aiAvailable
							? html`<wa-dropdown-item value="ai">
										${msg("Generate from an image")}
									</wa-dropdown-item>`
							: nothing
					}
				</wa-dropdown>
			</div>

			${this.#renderList(all.length, visible)}

			<planu-event-editor
				.open=${this.editorOpen}
				.event=${this.editing}
				.draft=${this.draft}
				.draftSource=${this.draftSource}
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
		const { event, source } = (domEvent as CustomEvent<GeneratedDraft>).detail;
		this.draft = event;
		this.draftSource = source;
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
		// Antes de nada el error: sin esto, un fallo de permisos o de cuota
		// dejaba `data` vacío y el usuario leía "todavía no tienes eventos",
		// que es exactamente la conclusión equivocada.
		if (this.#events.error) {
			return html`<wa-callout variant="danger" role="alert">
				${msg("Your events could not be loaded. Check your connection and reload.")}
			</wa-callout>`;
		}

		// Hay sesión pero Firestore aún viaja por su import dinámico. Sin esta
		// comprobación el controller no llega a suscribirse —su `loading` sigue
		// en false— y la vista concluía "todavía no tienes eventos" en cada
		// arranque en frío, indistinguible de una lista vacía de verdad.
		if (this.user && !this.firestore) return this.#renderSkeletons();

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
					? html`<p>${this.#emptyFilteredMessage()}</p>`
					: html`
							<p>${msg("You have no events yet.")}</p>
							<wa-button variant="brand" @click=${this.#onNew}>
								${msg("Create your first event")}
							</wa-button>
						`
			}
		</div>`;
	}

	/**
	 * With the inbox narrowed, "no results" is explained by the filter that
	 * actually caused it. Telling someone who simply has nothing shared to
	 * check their search sends them looking in the wrong place.
	 */
	#emptyFilteredMessage(): string {
		// Only when the inbox filter is the sole cause. With a search on top,
		// "you have not created any events" would be plainly false.
		const inboxOnly =
			this.searchTerm === "" && !this.range.from && !this.range.to;

		if (inboxOnly && this.ownership === "shared") {
			return msg("Nobody has shared an event with you yet.");
		}
		if (inboxOnly && this.ownership === "mine") {
			return msg("You have not created any events yet.");
		}
		return msg("No events match your search or date filter.");
	}

	#onFilters(event: Event): void {
		const detail = (event as CustomEvent<FiltersChange>).detail;
		this.searchTerm = detail.searchTerm;
		this.range = { from: detail.from, to: detail.to };
		this.ownership = detail.ownership;
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
