import "@awesome.me/webawesome/dist/components/details/details.js";
import "../events/event-card.js";

import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { shouldRevealPast } from "../domain/sort-events.js";
import type { StoredEvent } from "../lib/types.js";
import { type Agenda, type AgendaDay, countEvents } from "./agenda-days.js";

/**
 * Agenda vacía, como **fábrica** y no como constante de módulo.
 *
 * Una sola instancia compartida por todos los componentes es un objeto mutable
 * a nivel de módulo: hoy nadie hace `this.agenda.past.push(...)`, pero el día
 * que alguien lo haga la lista aparece en todas las agendas de la sesión y el
 * fallo no se parece en nada a su causa. Cuesta una llamada evitarlo.
 */
const emptyAgenda = (): Agenda<StoredEvent> => ({
	upcoming: [],
	undated: [],
	past: [],
});

/**
 * Agenda: los eventos en lista, agrupados por día.
 *
 * Recibe la agenda ya construida por `buildAgenda`, no los eventos sueltos, por
 * el mismo motivo que `event-groups` recibe los grupos: el reparto depende de
 * «ahora», y el reloj es una entrada que se lee en el borde. Aquí sólo se
 * pinta, y por eso esta vista se puede montar en un test sin emuladores y sin
 * congelar el tiempo.
 *
 * **Cada día es un `h2` y cada evento el `h3` de su tarjeta.** No hay un nivel
 * intermedio de «próximos» y «pasados» porque no cabe: la tarjeta fija su `h3`
 * desde T19, así que meter un encabezado más dejaría el evento al mismo nivel
 * que su día. Los pasados se distinguen por el pliegue, no por un encabezado.
 */
@customElement("planu-agenda-view")
export class PlanuAgendaView extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.day-title {
			margin-block: var(--wa-space-xl) 0;
			font-size: var(--wa-font-size-l);
		}

		/* El primero no separa del conmutador más de lo que ya lo hace la lista. */
		.day-title:first-of-type {
			margin-block-start: var(--wa-space-l);
		}

		.day-events {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
			gap: var(--wa-space-l);
			margin-block-start: var(--wa-space-m);
		}

		wa-details {
			margin-block-start: var(--wa-space-xl);
		}
	`;

	/** La agenda a pintar, ya ordenada y repartida en días. */
	@property({ attribute: false }) agenda: Agenda<StoredEvent> = emptyAgenda();

	/**
	 * Hay búsqueda, rango de fechas o etiquetas puestas. Lo decide quien tiene
	 * los filtros; aquí sólo se traslada a `shouldRevealPast`, la misma política
	 * que usa la rejilla de tarjetas.
	 */
	@property({ type: Boolean }) narrowed = false;

	override render() {
		const { agenda } = this;

		return html`
			${agenda.upcoming.map((day) => this.#renderDay(day))}
			${this.#renderUndated()}
			${this.#renderPast()}
		`;
	}

	#renderDay(day: AgendaDay<StoredEvent>) {
		return html`
			<h2 class="day-title">${day.label}</h2>
			${this.#renderEvents(day.events)}
		`;
	}

	/**
	 * Los que no tienen fecha, en su propio grupo y no colados entre los días.
	 *
	 * Es la misma regla que `filterEvents` y `groupEvents` ya fijan: sin ninguno
	 * de los dos extremos no hay día en el que ponerlos sin inventarlo.
	 */
	#renderUndated() {
		const { undated } = this.agenda;
		if (undated.length === 0) return nothing;

		return html`
			<h2 class="day-title">${msg("Without a date")}</h2>
			${this.#renderEvents(undated)}
		`;
	}

	/**
	 * Los días ya pasados, tras un pliegue.
	 *
	 * El encabezado de cada día va **dentro** del `wa-details`, y no hay un
	 * encabezado «Pasado» fuera: aquí el rótulo del pliegue ya nombra el control
	 * —`wa-details` lo pone en su `<summary role="button">`— y los días de dentro
	 * conservan sus `h2`, así que la navegación por encabezados llega a ellos en
	 * cuanto se abre. Es la diferencia con `event-groups`, donde el grupo entero
	 * era un solo montón y sin encabezado fuera se quedaba sin ninguno.
	 */
	#renderPast() {
		const { past } = this.agenda;
		if (past.length === 0) return nothing;

		const count = countEvents(past);
		const open = shouldRevealPast({
			upcoming: countEvents(this.agenda.upcoming),
			undated: this.agenda.undated.length,
			past: count,
			narrowed: this.narrowed,
		});

		return html`<wa-details summary=${this.#pastSummary(count)} .open=${open}>
			${past.map((day) => this.#renderDay(day))}
		</wa-details>`;
	}

	/**
	 * El rótulo del pliegue, con singular de verdad. Es el nombre accesible del
	 * control, no decoración; `@lit/localize` no tiene plurales ICU, de modo que
	 * la condicional es el patrón.
	 */
	#pastSummary(count: number): string {
		return count === 1
			? msg("Show 1 past event")
			: msg(str`Show ${count} past events`);
	}

	#renderEvents(events: readonly StoredEvent[]) {
		return html`<div class="day-events">
			${events.map(
				(event) => html`<planu-event-card .event=${event}></planu-event-card>`,
			)}
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-agenda-view": PlanuAgendaView;
	}
}
