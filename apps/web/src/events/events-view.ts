import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Listado de eventos.
 *
 * Marcador de posición: la consulta, las tarjetas y los filtros llegan en la
 * fase 3 (T6 y T7 de tasks/todo.md).
 */
@customElement("planu-events-view")
export class PlanuEventsView extends LitElement {
	static override styles = css`
		:host {
			display: block;
			padding: var(--wa-space-l);
		}
	`;

	override render() {
		return html`<p>No events yet.</p>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-events-view": PlanuEventsView;
	}
}
