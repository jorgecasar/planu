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

/** How long the notice stays on screen before it dismisses itself. */
const WARNING_MS = 8000;

/**
 * Exports events to the user's calendar: a downloadable `.ics` and, when
 * there's a single event, a link to the Google Calendar template.
 *
 * The same component serves both the card and the agenda because the only
 * difference is how many events it receives. Google Calendar only appears
 * with one: its template doesn't support more, and offering it for the
 * whole agenda would promise something it can't deliver.
 */
@customElement("planu-calendar-export")
export class PlanuCalendarExport extends LitElement {
	static override styles = css`
		:host {
			display: inline-block;
		}

		/*
		 * Fixed, and therefore out of the flow of whoever places us.
		 *
		 * The notice lives inside the component but can't depend on where it
		 * sits: the toolbar is a flex row with justify-content:
		 * space-between, so an in-flow notice would slip in as a column
		 * between the dropdown and the new-event button; and the card footer
		 * is another flex row. Anchoring it to the viewport takes it out of
		 * both and out of any overflow clipping.
		 */
		wa-callout {
			position: fixed;
			z-index: 10;
			inset-block-end: var(--wa-space-l);
			inset-inline-start: var(--wa-space-l);
			max-inline-size: min(28rem, calc(100vw - 2 * var(--wa-space-l)));
		}
	`;

	/** What gets exported. In the agenda these are the already-filtered events. */
	@property({ attribute: false }) events: readonly CalendarEvent[] = [];

	/**
	 * What's being exported, and **it's declared, not inferred**.
	 *
	 * The first version inferred it from `events.length === 1`, and with
	 * that the agenda toolbar would turn into a single-event exporter as
	 * soon as a filter left just one card visible: the label changed, it
	 * offered Google Calendar, and the file got named after the event
	 * instead of `planu-agenda.ics`. The component lives in two places with
	 * two different roles; inferring the role from the data confuses them.
	 */
	@property({ type: String }) mode: "event" | "agenda" = "event";

	/** File name used when exporting the agenda. */
	@property({ attribute: false }) agendaFileName = "planu-agenda.ics";

	@state() private warning = "";

	#warningTimer: ReturnType<typeof setTimeout> | undefined;

	get #exportable(): CalendarEvent[] {
		return this.events.filter(isExportable);
	}

	/**
	 * The single event, only in `event` mode. In the agenda it's always
	 * `undefined`, even if the filter has left just one card.
	 */
	get #single(): CalendarEvent | undefined {
		if (this.mode !== "event") return undefined;
		return this.events.length === 1 ? this.events[0] : undefined;
	}

	/** A notice anchored to the viewport that didn't dismiss itself would cover the interface. */
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
		// With no events there's nothing to export and the dropdown gets
		// disabled: a menu that can only answer "there's nothing" is worse
		// than a disabled button.
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
	 * What to say when no file comes out.
	 *
	 * With an empty agenda —a search with no results— saying "none of these
	 * events have dates" would be false: it's not that they're missing
	 * dates, it's that there are no events.
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
	 * An event with no dates doesn't produce a file: it warns instead.
	 *
	 * Exporting it would give a `VEVENT` with no `DTSTART`, which some
	 * clients reject entirely; and a file that won't open is worse than a
	 * warning, because the user doesn't know who to blame.
	 */
	#download(): void {
		const exportable = this.#exportable;
		if (exportable.length === 0) {
			this.#warn(this.#nothingToExport());
			return;
		}

		// Partial: what can be exported gets exported, and it says what got left out.
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
		// `noopener`: the Google tab must not be able to touch ours.
		window.open(url, "_blank", "noopener");
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-calendar-export": PlanuCalendarExport;
	}
}
