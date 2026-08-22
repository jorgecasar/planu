import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/checkbox-group/checkbox-group.js";
import "@awesome.me/webawesome/dist/components/checkbox/checkbox.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import type { DateRange, OwnershipFilter } from "../domain/filter-events.js";

export interface FiltersChange extends DateRange {
	searchTerm: string;
	ownership: OwnershipFilter;
	/** Combined with AND downstream: an event must carry all of them. */
	tags: string[];
}

/**
 * Reads the value from the native input that raised the event.
 *
 * `event.target.value` will not do: listening on the `wa-input` host, the
 * target arrives retargeted to the `wa-input` itself, whose `value` has not yet
 * synced with the inner input. The result is reading the previous value —
 * empty on the first keystroke — and filtering nothing.
 */
function readValue(event: globalThis.Event): string {
	const source = event.composedPath()[0] as HTMLInputElement | undefined;
	return source?.value ?? "";
}

/** Text search, date range, and which inbox to show. */
@customElement("planu-event-filters")
export class PlanuEventFilters extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		form {
			display: flex;
			flex-wrap: wrap;
			align-items: end;
			gap: var(--wa-space-m);
		}

		wa-input[type="search"] {
			flex: 1 1 16rem;
		}
	`;

	@state() private searchTerm = "";
	@state() private from = "";
	@state() private fromTime = "";
	@state() private to = "";
	@state() private toTime = "";
	@state() private ownership: OwnershipFilter = "all";
	@state() private tags: string[] = [];

	/** The tags the user already uses. Empty means no tag filter is offered. */
	@property({ attribute: false }) availableTags: readonly string[] = [];

	override render() {
		const filtered =
			this.searchTerm !== "" ||
			this.from !== "" ||
			this.to !== "" ||
			this.ownership !== "all" ||
			this.tags.length > 0;

		return html`
			<form role="search" @submit=${this.#onSubmit}>
				<wa-input
					type="search"
					name="search"
					label=${msg("Search")}
					placeholder=${msg("Title or description")}
					enterkeyhint="search"
					.value=${this.searchTerm}
					@input=${this.#onSearch}
				></wa-input>

				<wa-radio-group
					label=${msg("Show")}
					orientation="horizontal"
					.value=${this.ownership}
					@change=${this.#onOwnership}
				>
					<wa-radio appearance="button" value="all">${msg("All")}</wa-radio>
					<wa-radio appearance="button" value="mine">${msg("Mine")}</wa-radio>
					<wa-radio appearance="button" value="shared">
						${msg("Shared with me")}
					</wa-radio>
				</wa-radio-group>

				<wa-input
					type="date"
					name="from"
					label=${msg("From")}
					.value=${this.from}
					@change=${this.#onFrom}
				></wa-input>

				<wa-input
					type="time"
					name="fromTime"
					label=${msg("From time")}
					.value=${this.fromTime}
					@change=${this.#onFromTime}
				></wa-input>

				<wa-input
					type="date"
					name="to"
					label=${msg("To")}
					.value=${this.to}
					@change=${this.#onTo}
				></wa-input>

				<wa-input
					type="time"
					name="toTime"
					label=${msg("To time")}
					.value=${this.toTime}
					@change=${this.#onToTime}
				></wa-input>

				${this.#renderTags()}

				${
					filtered
						? html`<wa-button appearance="plain" @click=${this.#clear}>
								${msg("Clear filters")}
							</wa-button>`
						: null
				}
			</form>
		`;
	}

	/**
	 * Las etiquetas se ofrecen como casillas y no como botones que conmutan.
	 *
	 * Un botón que a veces está «pulsado» exige `aria-pressed` y explicarle al
	 * usuario que se acumulan; una casilla ya significa eso, y el grupo le pone
	 * nombre accesible sin inventarse nada. Se combinan con **Y**, y el texto
	 * del grupo lo dice, porque no es lo que la gente espera por defecto.
	 *
	 * Dos detalles que no son estilo, son corrección:
	 *
	 * `.checked` con `live()` y no `?checked`. En `wa-checkbox` el **atributo**
	 * `checked` mapea a `defaultChecked`, así que `?checked` escribe el valor
	 * inicial y no el vigente — y en cuanto el usuario pulsa una vez, el
	 * componente ignora el inicial para siempre. Con eso, «Borrar filtros»
	 * desfiltraba el listado y dejaba las casillas pintadas como marcadas. Y
	 * `live()` además de `.checked` porque Lit compara contra lo último que
	 * *él* pintó, no contra lo que el usuario dejó en el DOM.
	 *
	 * `repeat()` con clave por etiqueta. `availableTags` sale de los eventos y
	 * se reordena sola al crear uno. Con clave, Lit **mueve** el nodo de cada
	 * etiqueta en vez de reescribir el de esa posición, y quien esté navegando
	 * con el teclado sigue sobre la casilla que tenía enfocada en lugar de
	 * encontrarse sobre otra etiqueta. Lo demás —el marcado y el rótulo— lo
	 * reaplican `live()` y los *bindings* aunque no haya clave: un comentario
	 * anterior atribuía a la clave un fallo de rotulación que nadie ha
	 * conseguido reproducir. Lo que sí se rompe sin ella está en el test
	 * «reordenar no le mueve el foco a quien navega con el teclado».
	 *
	 * Se pintan las disponibles **más las seleccionadas**. Editar un evento
	 * puede dejar sin uso la última etiqueta por la que se estaba filtrando:
	 * `availableTags` la pierde, su casilla desaparece del DOM y el filtro sigue
	 * activo e invisible, con el listado vacío y nada marcado que lo explique.
	 * Se pinta en vez de podar `this.tags` porque podar cambia el filtro sin que
	 * el usuario lo pida —y ensancha el resultado en silencio—; mostrarla marcada
	 * deja la decisión donde estaba, a un clic de deshacerse.
	 */
	#renderTags() {
		const shown = [...new Set([...this.availableTags, ...this.tags])];
		if (shown.length === 0) return nothing;

		return html`<wa-checkbox-group
			label=${msg("Tags")}
			hint=${msg("An event must have all the tags you pick.")}
			orientation="horizontal"
		>
			${repeat(
				shown,
				(tag) => tag,
				(tag) => html`<wa-checkbox
					value=${tag}
					.checked=${live(this.tags.includes(tag))}
					@change=${() => this.#toggleTag(tag)}
				>${tag}</wa-checkbox>`,
			)}
		</wa-checkbox-group>`;
	}

	#toggleTag(tag: string): void {
		this.tags = this.tags.includes(tag)
			? this.tags.filter((each) => each !== tag)
			: [...this.tags, tag];
		this.#emit();
	}

	/** The form never navigates: filtering is live. */
	#onSubmit(event: SubmitEvent): void {
		event.preventDefault();
	}

	#onSearch(event: globalThis.Event): void {
		this.searchTerm = readValue(event);
		this.#emit();
	}

	#onFrom(event: globalThis.Event): void {
		this.from = readValue(event);
		this.#emit();
	}

	#onFromTime(event: globalThis.Event): void {
		this.fromTime = readValue(event);
		this.#emit();
	}

	#onTo(event: globalThis.Event): void {
		this.to = readValue(event);
		this.#emit();
	}

	#onToTime(event: globalThis.Event): void {
		this.toTime = readValue(event);
		this.#emit();
	}

	/**
	 * Re-emitting on an unchanged value locks the interface up. Rendering
	 * reassigns `.value` on the radio group, the group answers with `change`,
	 * this handler emits, the listing re-renders, and round it goes.
	 */
	#onOwnership(event: globalThis.Event): void {
		const group = event.target as HTMLElement & { value?: string };
		const chosen = (group.value ?? "all") as OwnershipFilter;
		if (chosen === this.ownership) return;

		this.ownership = chosen;
		this.#emit();
	}

	#clear(): void {
		this.searchTerm = "";
		this.from = "";
		this.fromTime = "";
		this.to = "";
		this.toTime = "";
		this.ownership = "all";
		this.tags = [];
		this.#emit();
	}

	#emit(): void {
		this.dispatchEvent(
			new CustomEvent<FiltersChange>("planu-filters-change", {
				detail: {
					searchTerm: this.searchTerm,
					ownership: this.ownership,
					// An empty date input is "", which as a Date would be invalid.
					// An empty time means the whole day, same as before this field
					// existed: "00:00:00" for the start of the range and "23:59:59"
					// for its end — exactly today's default, so no regression for
					// anyone who never touches these two fields. A time that is
					// present rounds to the start of that minute for "from" and the
					// end of it for "to": a "to" of 20:00 still catches something
					// that happened at 20:00:30.
					from: this.from
						? new Date(`${this.from}T${this.fromTime || "00:00"}:00`)
						: null,
					to: this.to
						? new Date(`${this.to}T${this.toTime || "23:59"}:59`)
						: null,
					tags: [...this.tags],
				},
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-filters": PlanuEventFilters;
	}
}
