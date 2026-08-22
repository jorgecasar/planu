import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/details/details.js";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatEventTime } from "../domain/format-dates.js";
import type { SortPreference } from "../domain/sort-events.js";
import { getLocale } from "../i18n/localization.js";
import type { StoredEvent } from "../lib/types.js";
import {
	buildMonthGrid,
	dayKey,
	firstDayOfWeek,
	type MonthCell,
} from "./month-grid.js";

/** Primer día del mes de una fecha, que es como se identifica un mes aquí. */
function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Rejilla mensual: un mes, sus semanas completas y los eventos de cada día.
 *
 * Recibe los eventos ya filtrados por propiedad y no habla con nadie más. El
 * conmutador entre vistas es otra tarea; aquí sólo se pinta el mes.
 *
 * **Sin librería de calendario**: CSS grid para la forma e `Intl.DateTimeFormat`
 * para los nombres. El reparto de eventos en celdas vive en `month-grid.ts`,
 * como función pura, que es donde se puede probar el cambio de horario de
 * verano sin montar nada.
 *
 * El teclado sigue el patrón `grid` de las APG, y no una invención propia:
 * flechas para moverse por días y semanas, `Inicio` y `Fin` para los extremos de
 * la semana, `Re Pág` y `Av Pág` para cambiar de mes, y **un solo punto de
 * tabulación** con foco itinerante —`tabindex="0"` en la celda activa y `-1` en
 * las demás—. Lo contrario, 42 celdas tabulables, obliga a 42 pulsaciones para
 * cruzar el calendario.
 */
@customElement("planu-calendar-view")
export class PlanuCalendarView extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--wa-space-s);
			margin-block-end: var(--wa-space-s);
		}

		/*
		 * El título no es un encabezado a propósito: el nivel que le tocaría
		 * depende de dónde lo monte el conmutador de vistas, y fijarlo aquí
		 * rompería el orden de encabezados de la página. La rejilla se nombra
		 * con aria-labelledby, que es lo que necesita quien navega con lector.
		 */
		.title {
			margin: 0;
			font-size: var(--wa-font-size-l);
			font-weight: var(--wa-font-weight-semibold);
		}

		.grid {
			display: grid;
			grid-template-columns: repeat(7, minmax(0, 1fr));
			gap: var(--wa-border-width-s);
			border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
			background-color: var(--wa-color-surface-border);
		}

		/*
		 * Las filas existen para el árbol de accesibilidad —role="grid" exige
		 * role="row"— pero no deben generar caja: con display: contents las
		 * celdas son hijas de la rejilla CSS y las siete columnas se alinean.
		 */
		.row {
			display: contents;
		}

		[role="columnheader"] {
			padding: var(--wa-space-2xs);
			background-color: var(--wa-color-surface-default);
			font-size: var(--wa-font-size-s);
			font-weight: var(--wa-font-weight-semibold);
			text-align: center;
		}

		[role="gridcell"] {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-2xs);
			min-height: 5rem;
			padding: var(--wa-space-2xs);
			background-color: var(--wa-color-surface-default);
		}

		[role="gridcell"]:focus-visible {
			outline: var(--wa-border-width-s) solid currentColor;
			outline-offset: calc(-1 * var(--wa-border-width-s));
		}

		.day {
			font-size: var(--wa-font-size-s);
			font-weight: var(--wa-font-weight-semibold);
		}

		.outside .day {
			color: var(--wa-color-text-quiet);
		}

		[aria-current="date"] .day {
			text-decoration: underline;
		}

		ul {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-2xs);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		/* En una celda de mes no cabe una tarjeta: entradas de una línea. */
		li {
			overflow: hidden;
			border-radius: var(--wa-border-radius-m);
			padding-inline: var(--wa-space-2xs);
			background-color: var(--wa-color-surface-border);
			font-size: var(--wa-font-size-s);
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.undated {
			margin-block: var(--wa-space-s) 0;
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		/*
		 * La utilidad wa-visually-hidden es una clase global y no cruza al
		 * shadow root, así que el texto para lectores se vería. Misma técnica,
		 * declarada donde aplica.
		 */
		.undated ul {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-2xs);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.sr-only {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
			border: 0;
		}
	`;

	/** Los eventos a repartir, ya filtrados por quien monta la vista. */
	@property({ attribute: false }) events: readonly StoredEvent[] = [];

	/**
	 * El mes visible. Es entrada y posición a la vez: navegar lo reasigna, de
	 * modo que quien monte la vista puede leerlo para saber dónde está.
	 */
	@property({ attribute: false }) month: Date = startOfMonth(new Date());

	/** Qué día es hoy. Por parámetro para que los tests no dependan del reloj. */
	@property({ attribute: false }) today: Date = new Date();

	/** Locale a usar. Vacío significa el que la interfaz está sirviendo. */
	@property() locale = "";

	/**
	 * Cómo ordenar dentro de cada celda. El mismo criterio que agenda y
	 * tarjetas, para que un congreso de tres días no salga en un orden en la
	 * rejilla y en otro en la agenda.
	 */
	@property({ attribute: false }) sort: SortPreference | undefined;

	/**
	 * Nivel del encabezado del mes. `0` —el valor por defecto— deja un párrafo.
	 *
	 * El nivel no puede fijarse aquí: depende de dónde se monte la rejilla, y en
	 * el listado el árbol es `h1 planu` → `h2 grupo` → `h3 tarjeta`, así que allí
	 * el mes es un `h2`. Fijar un `h2` dentro del componente lo rompería en
	 * cualquier otro sitio, y no ponerlo deja el mes fuera de la navegación por
	 * encabezados. De ahí que lo diga quien lo monta.
	 */
	@property({ type: Number, attribute: "heading-level" }) headingLevel = 0;

	/** El día con el foco itinerante. */
	@state() private focused: Date = new Date();

	/** Lo que se anuncia al cambiar de mes. Vacío hasta el primer cambio. */
	@state() private announcement = "";

	/**
	 * Sólo se devuelve el foco a la rejilla cuando el propio teclado lo movió.
	 * Hacerlo en cada render se lo robaría al usuario cada vez que llega un
	 * evento nuevo por la propiedad.
	 */
	#refocus = false;

	/**
	 * Reengancha el foco itinerante al mes visible.
	 *
	 * Hace falta porque el mes también puede cambiar desde fuera, y un foco
	 * apuntando a otro mes dejaría la rejilla sin ninguna celda con
	 * `tabindex="0"`: cuarenta y dos celdas y ni un punto de tabulación, es
	 * decir, un calendario fuera del recorrido del teclado.
	 *
	 * Se prefiere hoy cuando cae dentro, que es el día que el usuario espera
	 * encontrar al abrir un calendario.
	 */
	override willUpdate(): void {
		if (this.#sameMonth(this.focused)) return;

		this.focused = this.#sameMonth(this.today)
			? new Date(this.today.getTime())
			: startOfMonth(this.month);
	}

	#sameMonth(date: Date): boolean {
		return (
			date.getFullYear() === this.month.getFullYear() &&
			date.getMonth() === this.month.getMonth()
		);
	}

	override render() {
		const locale = this.locale || getLocale();
		const grid = buildMonthGrid(
			this.events,
			this.month,
			locale,
			this.today,
			this.sort,
		);
		const focusKey = dayKey(this.focused);

		return html`
			<div class="toolbar">
				<wa-button
					appearance="plain"
					@click=${() => this.#shiftMonth(-1)}
				>${msg("Previous month")}</wa-button>

				${this.#renderTitle(grid.title)}

				<wa-button
					appearance="plain"
					@click=${() => this.#shiftMonth(1)}
				>${msg("Next month")}</wa-button>
			</div>

			<div
				class="grid"
				role="grid"
				aria-labelledby="month-title"
				aria-readonly="true"
				@keydown=${this.#onKeydown}
			>
				<div class="row" role="row">
					${grid.weekdays.map(
						(weekday) => html`
							<span role="columnheader">
								<span class="sr-only">${weekday.long}</span>
								<span aria-hidden="true">${weekday.short}</span>
							</span>
						`,
					)}
				</div>

				${grid.weeks.map(
					(week) => html`
						<div class="row" role="row">
							${week.map((cell) => this.#renderCell(cell, focusKey, locale))}
						</div>
					`,
				)}
			</div>

			${this.#renderUndated(grid.undated)}

			<div class="sr-only" role="status">${this.announcement}</div>
		`;
	}

	/**
	 * El título del mes, con el nivel que le haya dado quien monta la vista.
	 *
	 * Un `switch` con etiquetas literales y no `unsafeStatic`: sólo hay dos
	 * niveles que tengan sentido aquí, y una plantilla estática construida desde
	 * una propiedad es una vía de inyección que no hace falta abrir por dos
	 * casos. El `id` es el mismo en los tres, porque es lo que nombra la rejilla
	 * por `aria-labelledby`.
	 */
	#renderTitle(title: string) {
		switch (this.headingLevel) {
			case 2:
				return html`<h2 class="title" id="month-title">${title}</h2>`;
			case 3:
				return html`<h3 class="title" id="month-title">${title}</h3>`;
			default:
				return html`<p class="title" id="month-title">${title}</p>`;
		}
	}

	/**
	 * Los eventos sin fecha, alcanzables y no sólo contados.
	 *
	 * Antes esto era un párrafo que decía cuántos había, y con eso un evento sin
	 * fecha quedaba anunciado pero inalcanzable: el usuario sabía que existía y
	 * no tenía forma de llegar a él desde aquí. Ahora se listan, cada uno con su
	 * botón, y elegir uno emite `planu-event-picked` para que quien monte la
	 * vista decida qué hacer —abrir el editor es lo natural, pero eso es de
	 * quien la monta, no de la rejilla—.
	 *
	 * Van en un `wa-details` plegado: son secundarios respecto al mes, y
	 * desplegados empujarían la rejilla fuera de la pantalla en cuanto haya unos
	 * cuantos.
	 */
	#renderUndated(undated: readonly StoredEvent[]) {
		if (undated.length === 0) return nothing;

		return html`<wa-details class="undated" summary=${this.#undatedNotice(undated.length)}>
			<ul>
				${undated.map(
					(event) => html`<li>
						<wa-button
							appearance="plain"
							size="small"
							@click=${() => this.#pick(event)}
						>${event.title}</wa-button>
					</li>`,
				)}
			</ul>
		</wa-details>`;
	}

	/** La rejilla no sabe qué hacer con un evento: lo dice y ya. */
	#pick(event: StoredEvent): void {
		this.dispatchEvent(
			new CustomEvent<StoredEvent>("planu-event-picked", {
				detail: event,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * La hora delante del título, o nada.
	 *
	 * Sólo si el evento tiene hora (`!allDay`) y sólo el día en que **empieza**:
	 * un congreso de tres días no repite «9:00» en los otros dos, porque ahí no
	 * es cuándo ocurre, es sólo un día en el que sigue en curso.
	 */
	#eventTime(event: StoredEvent, cellKey: number, locale: string): string {
		if (event.allDay || !event.startDate) return "";
		if (dayKey(event.startDate) !== cellKey) return "";
		return formatEventTime(event.startDate, locale);
	}

	/**
	 * Una celda.
	 *
	 * La fecha completa va como primer contenido y oculta a la vista, no como
	 * `aria-label`: la etiqueta taparía los títulos de los eventos, y entonces el
	 * lector diría el día pero no lo que pasa en él.
	 */
	#renderCell(cell: MonthCell<StoredEvent>, focusKey: number, locale: string) {
		return html`
			<div
				role="gridcell"
				class=${cell.inMonth ? "" : "outside"}
				tabindex=${cell.key === focusKey ? "0" : "-1"}
				aria-current=${cell.isToday ? "date" : "false"}
				data-key=${cell.key}
				@click=${() => this.#onCellClick(cell)}
			>
				<span class="sr-only">${cell.label}</span>
				<span class="day" aria-hidden="true">${cell.day}</span>
				${
					cell.events.length > 0
						? html`<ul>
								${cell.events.map((event) => {
									const time = this.#eventTime(event, cell.key, locale);
									return html`<li>${time ? `${time} ` : ""}${event.title}</li>`;
								})}
							</ul>`
						: nothing
				}
			</div>
		`;
	}

	/**
	 * El aviso de los eventos sin fecha.
	 *
	 * No caben en el calendario —una celda es una fecha— pero desaparecer sin
	 * más los daría por perdidos, así que se dice cuántos son. Dos formas y no
	 * una interpolación: en singular y en plural la frase cambia entera.
	 */
	#undatedNotice(count: number): string {
		return count === 1
			? msg("1 event without a date is not shown on the calendar")
			: msg(str`${count} events without a date are not shown on the calendar`);
	}

	/**
	 * Pinchar una celda se lleva allí el punto de tabulación.
	 *
	 * Y si esa celda era relleno de otro mes, además hay que **devolver el foco
	 * real**. La plantilla no lleva claves, así que Lit reutiliza los nodos por
	 * posición: al repintar el mes nuevo, el nodo que el usuario acaba de
	 * pinchar sigue enfocado y ya contiene otro día. Pinchando el 1 de julio
	 * desde junio, el `tabindex="0"` iba al 1 de julio pero el foco se quedaba
	 * en el nodo, que ahora era el 29 de julio: la siguiente flecha saltaba
	 * veintisiete días, y a un lector de pantalla lo dejaba en una celda de la
	 * que no le habían dicho nada.
	 *
	 * El reenganche va aquí y no dentro de `#focus()` porque por ahí pasan
	 * también los botones de la barra, y ésos no deben robar el foco.
	 */
	#onCellClick(cell: MonthCell<StoredEvent>): void {
		this.#refocus ||= !this.#sameMonth(cell.date);
		this.#focus(cell.date);
	}

	override updated(): void {
		if (!this.#refocus) return;
		this.#refocus = false;

		this.renderRoot
			.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')
			?.focus();
	}

	#onKeydown(domEvent: KeyboardEvent): void {
		// Con modificador no es nuestra tecla. `Control+Inicio` es «ir al
		// principio del documento» y `Mayús`+flecha, selección: entrar por la
		// rama de `Inicio` o de la flecha se los tragaría con `preventDefault()`.
		// Las APG reservan además `Mayús`+`Re/Av Pág` para cambiar de año, que
		// aquí no está: mejor no hacer nada que hacer otra cosa.
		if (
			domEvent.ctrlKey ||
			domEvent.metaKey ||
			domEvent.altKey ||
			domEvent.shiftKey
		) {
			return;
		}

		const steps: Record<string, number> = {
			ArrowRight: 1,
			ArrowLeft: -1,
			ArrowDown: 7,
			ArrowUp: -7,
		};

		const step = steps[domEvent.key];
		if (step !== undefined) {
			this.#moveBy(step);
		} else if (domEvent.key === "Home") {
			this.#moveBy(-this.#offsetInWeek());
		} else if (domEvent.key === "End") {
			this.#moveBy(6 - this.#offsetInWeek());
		} else if (domEvent.key === "PageUp") {
			this.#shiftMonth(-1);
		} else if (domEvent.key === "PageDown") {
			this.#shiftMonth(1);
		} else {
			return;
		}

		// Sólo tras haber reconocido la tecla: las flechas desplazan la página y
		// `Av Pág` la salta entera, y las dos cosas a la vez marean.
		domEvent.preventDefault();
		this.#refocus = true;
	}

	/** Días entre el día con foco y el primero de su semana, según el locale. */
	#offsetInWeek(): number {
		const first = firstDayOfWeek(this.locale || getLocale());
		return (this.focused.getDay() - first + 7) % 7;
	}

	/**
	 * Avanza o retrocede días.
	 *
	 * Con `setDate()`, nunca sumando milisegundos: un día no siempre dura 24
	 * horas y el día del cambio de hora dejaría el foco en la celda de al lado.
	 */
	#moveBy(days: number): void {
		const target = new Date(this.focused.getTime());
		target.setDate(target.getDate() + days);
		this.#focus(target);
	}

	/**
	 * Cambia de mes conservando el día.
	 *
	 * Se recorta al último día del mes destino: del 31 de enero, `Av Pág` lleva
	 * al 28 de febrero. Sin recortar, el desbordamiento de `Date` se saltaría
	 * febrero entero y aterrizaría en marzo.
	 */
	#shiftMonth(delta: number): void {
		const target = new Date(
			this.month.getFullYear(),
			this.month.getMonth() + delta,
			1,
		);
		const length = new Date(
			target.getFullYear(),
			target.getMonth() + 1,
			0,
		).getDate();

		this.#focus(
			new Date(
				target.getFullYear(),
				target.getMonth(),
				Math.min(this.focused.getDate(), length),
			),
		);
	}

	/** Mueve el foco a un día, cambiando de mes y anunciándolo si hace falta. */
	#focus(date: Date): void {
		const changed = !this.#sameMonth(date);
		this.focused = date;
		if (!changed) return;

		this.month = startOfMonth(date);

		// El mes vive en un `role="status"` aparte y no en el título visible:
		// marcar el título como región viva lo haría anunciarse también al
		// pintar por primera vez, cuando nadie ha cambiado nada.
		const title = new Intl.DateTimeFormat(this.locale || getLocale(), {
			year: "numeric",
			month: "long",
		}).format(this.month);
		this.announcement = msg(str`Showing ${title}`);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-calendar-view": PlanuCalendarView;
	}
}
