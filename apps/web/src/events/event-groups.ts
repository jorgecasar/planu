import "@awesome.me/webawesome/dist/components/details/details.js";
import "./event-card.js";

import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type EventGroups, shouldRevealPast } from "../domain/sort-events.js";
import type { StoredEvent } from "../lib/types.js";

const EMPTY: EventGroups<StoredEvent> = { upcoming: [], undated: [], past: [] };

/**
 * Pinta los tres grupos del listado.
 *
 * Vive aparte de `events-view` a propósito: aquélla consume `Firestore` y
 * `User` por contexto, así que no se puede montar en un test sin emuladores, y
 * el fallo que trajo esta revisión —el pliegue de pasados escondiendo todos los
 * resultados de una búsqueda— se coló justo por ahí. Aquí sólo entran datos ya
 * resueltos, y eso convierte la agrupación en algo con oráculo.
 */
@customElement("planu-event-groups")
export class PlanuEventGroups extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
			gap: var(--wa-space-l);
			margin-block-start: var(--wa-space-l);
		}

		.group-title {
			margin-block: var(--wa-space-xl) 0;
			font-size: var(--wa-font-size-l);
		}

		/* El primero no separa del filtro más de lo que ya lo hace la rejilla. */
		.group-title:first-of-type {
			margin-block-start: var(--wa-space-l);
		}

		wa-details {
			margin-block-start: var(--wa-space-m);
		}
	`;

	@property({ attribute: false }) groups: EventGroups<StoredEvent> = EMPTY;

	/**
	 * Hay búsqueda o rango de fechas puestos. Lo decide quien tiene los filtros;
	 * aquí sólo se traslada a `shouldRevealPast`.
	 */
	@property({ type: Boolean }) narrowed = false;

	/**
	 * El rótulo del pliegue, con singular de verdad.
	 *
	 * Decía «Show 1 past events» en el caso más común de todos, y no es
	 * decoración: `wa-details` lo pone en su `<summary role="button">`, así que
	 * es el **nombre accesible** del control. `@lit/localize` no tiene plurales
	 * ICU, de modo que la condicional es el patrón.
	 */
	#pastSummary(count: number): string {
		return count === 1
			? msg("Show 1 past event")
			: msg(str`Show ${count} past events`);
	}

	override render() {
		const { groups } = this;

		// Los pasados van al final: lo plegado es lo último de la página, y los
		// que no tienen fecha quedan en medio para que siga siéndolo.
		return html`
			${this.#renderGroup(msg("Upcoming"), groups.upcoming)}
			${this.#renderGroup(msg("Without a date"), groups.undated)}
			${this.#renderPast()}
		`;
	}

	#renderGroup(title: string, events: readonly StoredEvent[]) {
		if (events.length === 0) return nothing;

		return html`
			<h2 class="group-title">${title}</h2>
			${this.#renderGrid(events)}
		`;
	}

	/**
	 * El encabezado va **fuera** del `wa-details`, no en su slot `summary`.
	 *
	 * Parece más limpio meterlo dentro, y en un `<details>` nativo lo sería,
	 * pero `wa-details` marca su `<summary>` con `role="button"` y ARIA declara
	 * presentacionales a los hijos de un botón: un `<h2>` ahí existe en el DOM y
	 * **no** en el árbol de accesibilidad, así que la navegación por encabezados
	 * seguiría sin llegar a los pasados. Fuera, los tres grupos tienen la misma
	 * forma. Axe no detecta ninguna de las dos cosas.
	 */
	#renderPast() {
		const { past } = this.groups;
		if (past.length === 0) return nothing;

		const open = shouldRevealPast({
			upcoming: this.groups.upcoming.length,
			undated: this.groups.undated.length,
			past: past.length,
			narrowed: this.narrowed,
		});

		return html`
			<h2 class="group-title">${msg("Past")}</h2>
			<wa-details
				summary=${this.#pastSummary(past.length)}
				.open=${open}
			>
				${this.#renderGrid(past)}
			</wa-details>
		`;
	}

	#renderGrid(events: readonly StoredEvent[]) {
		return html`<div class="grid">
			${events.map(
				(event) => html`<planu-event-card .event=${event}></planu-event-card>`,
			)}
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-groups": PlanuEventGroups;
	}
}
