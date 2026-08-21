import "@awesome.me/webawesome/dist/components/details/details.js";
import "../events/event-card.js";

import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { shouldRevealPast } from "../domain/sort-events.js";
import type { StoredEvent } from "../lib/types.js";
import { type Agenda, type AgendaDay, countEvents } from "./agenda-days.js";

/**
 * Empty agenda, as a **factory** and not as a module-level constant.
 *
 * A single instance shared by every component is a module-level mutable
 * object: today nobody does `this.agenda.past.push(...)`, but the day
 * somebody does, the list shows up in every agenda of the session and the
 * failure looks nothing like its cause. Avoiding it costs one function call.
 */
const emptyAgenda = (): Agenda<StoredEvent> => ({
	upcoming: [],
	undated: [],
	past: [],
});

/**
 * Agenda: the events in a list, grouped by day.
 *
 * It receives the agenda already built by `buildAgenda`, not the loose
 * events, for the same reason `event-groups` receives the groups: the split
 * depends on "now", and the clock is an input that's read at the edge. Here
 * it's only painted, and that's why this view can be mounted in a test
 * without emulators and without freezing time.
 *
 * **Each day is an `h2` and each event the `h3` of its card.** There's no
 * intermediate level for "upcoming" and "past" because there's no room for
 * it: the card has fixed its `h3` since T19, so adding one more heading would
 * leave the event at the same level as its day. Past events are told apart by
 * the fold, not by a heading.
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

		/* The first one doesn't separate from the switcher any more than the list already does. */
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

	/** The agenda to paint, already sorted and spread across days. */
	@property({ attribute: false }) agenda: Agenda<StoredEvent> = emptyAgenda();

	/**
	 * There's a search, date range, or tags set. It's decided by whoever holds
	 * the filters; here it's only passed on to `shouldRevealPast`, the same
	 * policy the card grid uses.
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
	 * The ones without a date, in their own group and not slipped in among the
	 * days.
	 *
	 * It's the same rule that `filterEvents` and `groupEvents` already set:
	 * without either end there's no day to put them on without inventing one.
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
	 * The already-past days, behind a fold.
	 *
	 * Each day's heading goes **inside** the `wa-details`, and there's no
	 * "Past" heading outside: here the fold's label already names the control
	 * —`wa-details` puts it in its `<summary role="button">`— and the days
	 * inside keep their `h2`s, so heading navigation reaches them as soon as
	 * it opens. That's the difference from `event-groups`, where the whole
	 * group was a single pile and without a heading outside it was left with
	 * none.
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
	 * The fold's label, with a real singular. It's the control's accessible
	 * name, not decoration; `@lit/localize` has no ICU plurals, so the
	 * conditional is the pattern.
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
