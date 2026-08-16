import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	buildIcs,
	type CalendarEvent,
	ICS_MIME_TYPE,
	icsFileName,
	isExportable,
} from "../domain/build-ics.js";
import { googleCalendarUrl } from "../domain/google-calendar-url.js";
import { downloadTextFile } from "../lib/download-file.js";

/** Cuánto se queda el aviso en pantalla antes de irse solo. */
const WARNING_MS = 8000;

/**
 * Exporta eventos al calendario del usuario: un `.ics` descargable y, cuando
 * hay un solo evento, un enlace a la plantilla de Google Calendar.
 *
 * El mismo componente sirve a la tarjeta y a la agenda porque la única
 * diferencia es cuántos eventos recibe. Google Calendar sólo aparece con uno:
 * su plantilla no admite más, y ofrecerlo para la agenda entera prometería algo
 * que no puede cumplir.
 */
@customElement("planu-calendar-export")
export class PlanuCalendarExport extends LitElement {
	static override styles = css`
		:host {
			display: inline-block;
		}

		/*
		 * Fijo, y por tanto fuera del flujo de quien nos coloque.
		 *
		 * El aviso vive dentro del componente pero no puede depender de dónde
		 * esté: la barra de herramientas es una fila flex con
		 * justify-content: space-between, así que un aviso en flujo se colaba
		 * como columna entre el desplegable y el botón de nuevo evento; y el pie
		 * de la tarjeta es otra fila flex. Anclarlo a la ventana lo saca de
		 * ambos y de cualquier recorte por overflow.
		 */
		wa-callout {
			position: fixed;
			z-index: 10;
			inset-block-end: var(--wa-space-l);
			inset-inline-start: var(--wa-space-l);
			max-inline-size: min(28rem, calc(100vw - 2 * var(--wa-space-l)));
		}
	`;

	/** Lo que se exporta. En la agenda son los eventos ya filtrados. */
	@property({ attribute: false }) events: readonly CalendarEvent[] = [];

	/**
	 * Qué se está exportando, y **se declara, no se deduce**.
	 *
	 * La primera versión lo inferría de `events.length === 1`, y con eso la
	 * barra de la agenda se convertía en un exportador de un solo evento en
	 * cuanto un filtro dejaba una sola tarjeta visible: cambiaba el rótulo,
	 * ofrecía Google Calendar y el fichero pasaba a llamarse como el evento en
	 * vez de `planu-agenda.ics`. El componente vive en dos sitios con dos
	 * papeles distintos; deducir el papel de los datos los confunde.
	 */
	@property({ type: String }) mode: "event" | "agenda" = "event";

	/** Nombre del fichero cuando se exporta la agenda. */
	@property({ attribute: false }) agendaFileName = "planu-agenda.ics";

	@state() private warning = "";

	#warningTimer: ReturnType<typeof setTimeout> | undefined;

	get #exportable(): CalendarEvent[] {
		return this.events.filter(isExportable);
	}

	/**
	 * El evento único, sólo en modo `event`. En la agenda es siempre
	 * `undefined`, aunque el filtro haya dejado una sola tarjeta.
	 */
	get #single(): CalendarEvent | undefined {
		if (this.mode !== "event") return undefined;
		return this.events.length === 1 ? this.events[0] : undefined;
	}

	/** Un aviso anclado a la ventana que no se fuera solo taparía la interfaz. */
	#warn(message: string): void {
		this.warning = message;
		clearTimeout(this.#warningTimer);
		if (message === "") return;
		this.#warningTimer = setTimeout(() => {
			this.warning = "";
		}, WARNING_MS);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		clearTimeout(this.#warningTimer);
	}

	override render() {
		const single = this.#single;
		// Sin ningún evento no hay nada que exportar y el desplegable se
		// deshabilita: un menú que sólo puede contestar «no hay nada» es peor que
		// un botón apagado.
		const empty = this.events.length === 0;

		return html`
			<wa-dropdown @wa-select=${this.#onSelect}>
				<wa-button
					slot="trigger"
					appearance="plain"
					?disabled=${empty}
					.withCaret=${true}
				>
					${single ? msg("Add to calendar") : msg("Export calendar")}
				</wa-button>
				<wa-dropdown-item value="ics">
					${msg("Download .ics file")}
				</wa-dropdown-item>
				${
					single
						? html`<wa-dropdown-item value="google">
								${msg("Add to Google Calendar")}
							</wa-dropdown-item>`
						: nothing
				}
			</wa-dropdown>

			${
				this.warning
					? html`<wa-callout variant="warning" role="alert">
							${this.warning}
						</wa-callout>`
					: nothing
			}
		`;
	}

	#onSelect(domEvent: Event): void {
		const value = (domEvent as CustomEvent<{ item: { value: string } }>).detail
			.item.value;
		if (value === "google") this.#openGoogle();
		else this.#download();
	}

	/**
	 * Qué decir cuando no sale ningún fichero.
	 *
	 * Con la agenda vacía —una búsqueda sin resultados— decir «ninguno de estos
	 * eventos tiene fechas» sería falso: no es que les falten fechas, es que no
	 * hay eventos.
	 */
	#nothingToExport(): string {
		if (this.events.length === 0) return msg("There are no events to export.");
		return this.#single
			? msg(
					"This event has no dates yet, so there is nothing to add to a calendar.",
				)
			: msg("None of these events have dates, so there is nothing to export.");
	}

	/**
	 * Un evento sin fechas no genera fichero: se avisa.
	 *
	 * Exportarlo daría un `VEVENT` sin `DTSTART`, que algunos clientes rechazan
	 * entero; y un fichero que no se abre es peor que un aviso, porque el
	 * usuario no sabe a quién echarle la culpa.
	 */
	#download(): void {
		const exportable = this.#exportable;
		if (exportable.length === 0) {
			this.#warn(this.#nothingToExport());
			return;
		}

		// Parcial: se exporta lo que se puede y se dice qué se ha quedado fuera.
		this.#warn(
			exportable.length < this.events.length
				? msg("The events without dates were left out of the file.")
				: "",
		);

		const name = this.#single
			? icsFileName(this.#single.title)
			: this.agendaFileName;
		downloadTextFile(
			buildIcs(exportable, { now: new Date() }),
			name,
			ICS_MIME_TYPE,
		);
	}

	#openGoogle(): void {
		const single = this.#single;
		const url = single ? googleCalendarUrl(single) : null;
		if (!url) {
			this.#warn(this.#nothingToExport());
			return;
		}

		this.#warn("");
		// `noopener`: la pestaña de Google no debe poder tocar la nuestra.
		window.open(url, "_blank", "noopener");
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-calendar-export": PlanuCalendarExport;
	}
}
