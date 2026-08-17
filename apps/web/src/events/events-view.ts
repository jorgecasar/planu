import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/option/option.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import "@awesome.me/webawesome/dist/components/select/select.js";
import "@awesome.me/webawesome/dist/components/skeleton/skeleton.js";
import "../calendar/agenda-view.js";
import "../calendar/calendar-view.js";
import "./ai-event-generator.js";
import "./calendar-export.js";
import "./event-card.js";
import { canOffer, checkAvailability } from "../domain/ai-availability.js";
import type { InferenceSourceName } from "../domain/ai-policy.js";
import type { GeneratedDraft } from "./ai-event-generator.js";
import "./event-editor.js";
import "./event-filters.js";
import "./event-groups.js";
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
import { buildAgenda } from "../calendar/agenda-days.js";
import {
	type DateRange,
	filterEvents,
	isNarrowed,
	type OwnershipFilter,
} from "../domain/filter-events.js";
import {
	groupEvents,
	parseSortPreference,
	type SortPreference,
	serializeSortPreference,
	sortOptions,
} from "../domain/sort-events.js";
import {
	parseViewMode,
	type ViewMode,
	viewOptions,
} from "../domain/view-mode.js";
import { CollectionController } from "../firebase/collection-controller.js";
import { firestoreContext, userContext } from "../firebase/context.js";
import { getLocale } from "../i18n/localization.js";
import {
	eventSchema,
	type PlanuEvent,
	type StoredEvent,
} from "../lib/types.js";
import {
	readSortPreference,
	readViewMode,
	writeSortPreference,
	writeViewMode,
} from "../lib/view-preferences.js";
import type { FiltersChange } from "./event-filters.js";

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
		tags: document["tags"],
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

		wa-select {
			flex: 0 1 14rem;
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
	@state() private tags: string[] = [];
	@state() private editorOpen = false;
	@state() private editing: StoredEvent | undefined;
	@state() private generatorOpen = false;
	@state() private draft: Partial<PlanuEvent> | undefined;
	@state() private draftSource: InferenceSourceName | undefined;
	@state() private aiAvailable = false;

	/**
	 * El orden elegido, recuperado de la sesión anterior. Se lee al construir y
	 * no en `connectedCallback`, para que el primer render ya salga ordenado
	 * como el usuario lo dejó y no salte a la vista.
	 */
	@state() private sort: SortPreference = readSortPreference();

	/**
	 * La vista elegida, recuperada de la sesión anterior.
	 *
	 * Se lee en el inicializador del campo, igual que el orden, con la intención
	 * de que el primer render ya salga como el usuario lo dejó. **Esa intención
	 * no tiene oráculo**: moverla a `connectedCallback` no rompe ningún test, y
	 * un salto de un fotograma no es algo que la suite sepa mirar. Se deja donde
	 * está por coherencia con `sort` y porque no cuesta nada, no porque esté
	 * demostrado que haga falta.
	 */
	@state() private view: ViewMode = readViewMode();

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

		// La rejilla mensual emite `planu-event-picked` cuando el usuario elige
		// uno de los eventos sin fecha que no caben en ninguna celda, y no decide
		// qué hacer con él a propósito. Aquí se decide: **abrir el editor**, que
		// es lo mismo que hace pulsar la tarjeta en la rejilla de tarjetas. La
		// alternativa —llevar el calendario al mes del evento— no existe: un
		// evento sin fecha no tiene mes al que ir, y ponerle uno es justo lo que
		// el usuario tendría que decidir en el editor.
		this.addEventListener("planu-event-picked", (domEvent) => {
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
			this.tags,
		);

		// Las etiquetas que se ofrecen salen de los eventos que el usuario ya
		// tiene, no de una colección aparte: así no hay nada que mantener
		// sincronizado ni una consulta más que pagar.
		const knownTags = [...new Set(all.flatMap((event) => event.tags))].sort(
			(a, b) => a.localeCompare(b),
		);

		return html`
			<planu-invitations-inbox></planu-invitations-inbox>

			<div class="toolbar">
				<planu-event-filters
					.availableTags=${knownTags}
					@planu-filters-change=${this.#onFilters}
				></planu-event-filters>

				<wa-radio-group
					class="views"
					label=${msg("View")}
					orientation="horizontal"
					.value=${this.view}
					@change=${this.#onView}
				>
					${viewOptions().map(
						(option) =>
							html`<wa-radio appearance="button" value=${option.value}>
								${option.label}
							</wa-radio>`,
					)}
				</wa-radio-group>

				<wa-select
					label=${msg("Sort by")}
					.value=${serializeSortPreference(this.sort)}
					@change=${this.#onSort}
				>
					${sortOptions().map(
						(option) =>
							html`<wa-option value=${option.value}>${option.label}</wa-option>`,
					)}
				</wa-select>

				<!-- La agenda que se exporta es la que se está viendo: los mismos
				     eventos que ya han pasado por los filtros, **antes** de agrupar.
				     Si alguien le pasa aquí \`groups\` en vez de \`visible\`, el .ics se
				     queda con un solo grupo y no lo detecta nada: los unitarios usan
				     sus propios datos y el e2e sólo comprueba que un filtro reduce a
				     un VEVENT. -->
				<planu-calendar-export
					mode="agenda"
					.events=${visible}
				></planu-calendar-export>
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
				.knownTags=${knownTags}
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

		// `visible` y no `all`: **el filtro es de la pantalla, no de la rejilla de
		// tarjetas**. Las tres vistas cuelgan de esta misma línea y reciben lo
		// mismo, que es lo que hace imposible que una se quede sin filtrar. Y el
		// mensaje de «nada coincide» sale antes del reparto, también para las
		// tres: un calendario vacío no explica por qué está vacío.
		//
		// `new Date()` aquí y no dentro del dominio: el reloj es una entrada, y
		// esta vista es el borde donde se lee. `groupEvents` y `buildAgenda`
		// reciben el instante y así se pueden probar sin depender de cuándo se
		// ejecuten los tests.
		//
		// Se lee en cada repintado y no hay temporizador, así que un evento que
		// termina con la página abierta no salta de «próximos» a «pasados» hasta
		// el siguiente render —un filtro, un cambio de orden, un snapshot—.
		// Deliberado: un `setInterval` para reordenar la pantalla bajo el cursor
		// molesta más de lo que corrige.
		const now = new Date();

		// El idioma **de la interfaz**, no el del navegador.
		//
		// `src/i18n/localization.ts` avisa de este peligro por su nombre y
		// `calendar-view` ya lo obedece: si el navegador pide alemán, la interfaz
		// sirve inglés, y sin pasar el locale `Intl` formateaba los encabezados de
		// día de la agenda en alemán dentro de una pantalla en inglés. Va también
		// a `groupEvents` porque el mismo valor gobierna la colación del orden
		// alfabético, y que las dos vistas ordenen distinto sería la misma clase
		// de divergencia que esta revisión vino a cerrar.
		const locale = getLocale();

		if (this.view === "calendar") {
			// `heading-level="2"` porque el árbol de la página es h1 planu → h2
			// grupo → h3 tarjeta, y el mes ocupa el sitio del grupo.
			return html`<planu-calendar-view
				heading-level="2"
				.events=${visible}
			></planu-calendar-view>`;
		}

		if (this.view === "agenda") {
			return html`<planu-agenda-view
				.agenda=${buildAgenda(visible, { now, sort: this.sort, locale })}
				?narrowed=${this.#narrowed}
			></planu-agenda-view>`;
		}

		return html`<planu-event-groups
			.groups=${groupEvents(visible, { now, sort: this.sort, locale })}
			?narrowed=${this.#narrowed}
		></planu-event-groups>`;
	}

	/**
	 * El usuario ha pedido algo concreto. Decide si el grupo de pasados sale
	 * abierto (ver `shouldRevealPast`) y también qué mensaje de «sin resultados»
	 * se enseña.
	 *
	 * Una sola fuente para las dos preguntas, y en `domain/`: estaban duplicadas
	 * y discrepaban justo en las etiquetas, así que pulsar la etiqueta «música»
	 * y escribir «música» —misma intención, mismos resultados— abrían o no el
	 * pliegue según cuál usaras.
	 */
	get #narrowed(): boolean {
		return isNarrowed({
			searchTerm: this.searchTerm,
			from: this.range.from,
			to: this.range.to,
			tags: this.tags,
		});
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
		const inboxOnly = !this.#narrowed;

		if (inboxOnly && this.ownership === "shared") {
			return msg("Nobody has shared an event with you yet.");
		}
		if (inboxOnly && this.ownership === "mine") {
			return msg("You have not created any events yet.");
		}
		return msg("No events match your search, tags or date filter.");
	}

	#onFilters(event: Event): void {
		const detail = (event as CustomEvent<FiltersChange>).detail;
		this.searchTerm = detail.searchTerm;
		this.range = { from: detail.from, to: detail.to };
		this.ownership = detail.ownership;
		this.tags = detail.tags;
	}

	/**
	 * Reasignar `.value` en cada render hace que el `wa-select` responda con
	 * `change`; sin la guarda, esto reasignaría el estado, provocaría otro
	 * render y volvería a empezar. Es el mismo bucle que ya documenta el grupo
	 * de radios de `event-filters.ts`.
	 */
	#onSort(domEvent: Event): void {
		const select = domEvent.target as HTMLElement & { value?: string };
		const chosen = parseSortPreference(select.value);
		if (
			serializeSortPreference(chosen) === serializeSortPreference(this.sort)
		) {
			return;
		}

		this.sort = chosen;
		writeSortPreference(chosen);
	}

	/**
	 * Igual que el orden, y con la misma guarda: reasignar `.value` en cada
	 * render hace que el `wa-radio-group` responda con `change`, y sin comparar
	 * antes esto reasignaría el estado, provocaría otro render y volvería a
	 * empezar.
	 *
	 * El valor pasa por `parseViewMode` aunque venga de nuestros propios radios:
	 * es el mismo saneado que se aplica a lo que llega de `localStorage`, y así
	 * no hay dos caminos por los que el estado pueda tomar valores distintos.
	 */
	#onView(domEvent: Event): void {
		const group = domEvent.target as HTMLElement & { value?: string };
		const chosen = parseViewMode(group.value);
		if (chosen === this.view) return;

		this.view = chosen;
		writeViewMode(chosen);
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
