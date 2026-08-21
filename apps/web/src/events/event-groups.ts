import "@awesome.me/webawesome/dist/components/details/details.js";
import "./event-card.js";

import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type EventGroups, shouldRevealPast } from "../domain/sort-events.js";
import type { StoredEvent } from "../lib/types.js";

const EMPTY: EventGroups<StoredEvent> = { upcoming: [], undated: [], past: [] };

/**
 * Paints the listing's three groups.
 *
 * Lives apart from `events-view` on purpose: that one consumes `Firestore`
 * and `User` through context, so it can't be mounted in a test without
 * emulators, and the bug that prompted this review —the past-events fold
 * hiding every search result— slipped in exactly through that gap. Here
 * only already-resolved data comes in, and that's what turns grouping
 * into something with an oracle.
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

		/* The first one doesn't separate from the filter any more than the grid already does. */
		.group-title:first-of-type {
			margin-block-start: var(--wa-space-l);
		}

		wa-details {
			margin-block-start: var(--wa-space-m);
		}
	`;

	@property({ attribute: false }) groups: EventGroups<StoredEvent> = EMPTY;

	/**
	 * Whether a search or date range is set. Whoever holds the filters
	 * decides this; here it's only passed along to `shouldRevealPast`.
	 */
	@property({ type: Boolean }) narrowed = false;

	/**
	 * The fold's label, with an actual singular.
	 *
	 * It used to say "Show 1 past events" in the most common case of all,
	 * and that isn't decoration: `wa-details` puts it in its
	 * `<summary role="button">`, so it's the control's **accessible name**.
	 * `@lit/localize` has no ICU plurals, so the conditional is the pattern.
	 */
	#pastSummary(count: number): string {
		return count === 1
			? msg("Show 1 past event")
			: msg(str`Show ${count} past events`);
	}

	override render() {
		const { groups } = this;

		// Past events go last: the folded section is the last thing on the
		// page, and the undated ones stay in the middle so it stays that way.
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
	 * The heading goes **outside** the `wa-details`, not in its `summary`
	 * slot.
	 *
	 * Putting it inside seems cleaner, and in a native `<details>` it would
	 * be, but `wa-details` marks its `<summary>` with `role="button"` and
	 * ARIA declares a button's children presentational: an `<h2>` there
	 * exists in the DOM and **not** in the accessibility tree, so heading
	 * navigation would still never reach the past events. Outside, the
	 * three groups have the same shape. Axe catches neither issue.
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
