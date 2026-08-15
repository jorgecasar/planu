import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { DateRange } from "./filter-events.js";

export interface FiltersChange extends DateRange {
	searchTerm: string;
}

/**
 * Lee el valor del input nativo que originó el evento.
 *
 * No vale `event.target.value`: al escuchar en el host de `wa-input`, el
 * objetivo llega retargeteado al propio `wa-input`, cuya propiedad `value`
 * todavía no se ha sincronizado con la del input interno. El resultado es leer
 * el valor anterior —vacío en la primera pulsación— y no filtrar nada.
 */
function valueOf(event: globalThis.Event): string {
	const source = event.composedPath()[0] as HTMLInputElement | undefined;
	return source?.value ?? "";
}

/** Búsqueda por texto y acotado por rango de fechas. */
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
	@state() private to = "";

	override render() {
		const filtered = this.searchTerm !== "" || this.from !== "" || this.to !== "";

		return html`
			<form role="search" @submit=${this.#onSubmit}>
				<wa-input
					type="search"
					name="search"
					label="Search"
					placeholder="Title or description"
					enterkeyhint="search"
					.value=${this.searchTerm}
					@input=${this.#onSearch}
				></wa-input>

				<wa-input
					type="date"
					name="from"
					label="From"
					.value=${this.from}
					@change=${this.#onFrom}
				></wa-input>

				<wa-input
					type="date"
					name="to"
					label="To"
					.value=${this.to}
					@change=${this.#onTo}
				></wa-input>

				${
					filtered
						? html`<wa-button appearance="plain" @click=${this.#clear}>
								Clear filters
							</wa-button>`
						: null
				}
			</form>
		`;
	}

	/** El formulario no navega: filtrar es en vivo. */
	#onSubmit(event: SubmitEvent): void {
		event.preventDefault();
	}

	#onSearch(event: globalThis.Event): void {
		this.searchTerm = valueOf(event);
		this.#emit();
	}

	#onFrom(event: globalThis.Event): void {
		this.from = valueOf(event);
		this.#emit();
	}

	#onTo(event: globalThis.Event): void {
		this.to = valueOf(event);
		this.#emit();
	}

	#clear(): void {
		this.searchTerm = "";
		this.from = "";
		this.to = "";
		this.#emit();
	}

	#emit(): void {
		this.dispatchEvent(
			new CustomEvent<FiltersChange>("planu-filters-change", {
				detail: {
					searchTerm: this.searchTerm,
					// Un date input vacío es "", que como Date sería inválido.
					from: this.from ? new Date(`${this.from}T00:00:00`) : null,
					to: this.to ? new Date(`${this.to}T23:59:59`) : null,
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
