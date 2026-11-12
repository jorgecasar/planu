import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/option/option.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import "@awesome.me/webawesome/dist/components/select/select.js";
import "@awesome.me/webawesome/dist/components/skeleton/skeleton.js";

import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { buildAgenda } from "../calendar/agenda-days.js";
import { canOffer, checkAvailability } from "../domain/ai-availability.js";
import type { InferenceSourceName } from "../domain/ai-policy.js";
import { type ListingState, listingState } from "../domain/listing-state.js";
import { sampleEventDraft } from "../domain/sample-event.js";
import { collectTags } from "../domain/tags.js";
import "../calendar/agenda-view.js";
import "../calendar/calendar-view.js";

import {
	type EventsSnapshot,
	eventsContext,
	eventsInterestContext,
	userContext,
} from "../application/context.js";
import {
	type DateRange,
	filterEvents,
	isNarrowed,
	type OwnershipFilter,
} from "../domain/filter-events.js";

import {
	groupEvents,
	parseSortPreference,
	type SortPreference,
	sameSortPreference,
	serializeSortPreference,
	sortOptions,
} from "../domain/sort-events.js";

import {
	parseViewMode,
	type ViewMode,
	viewOptions,
} from "../domain/view-mode.js";
import { getLocale } from "../i18n/localization.js";

import type { PlanuEvent, StoredEvent } from "../lib/types.js";

import {
	readSortPreference,
	readViewMode,
	writeSortPreference,
	writeViewMode,
} from "../lib/view-preferences.js";

import "./calendar-export.js";
import "./empty-state.js";
import "./event-card.js";
import "./event-editor.js";
import "./event-filters.js";
import "./event-groups.js";
import "../sharing/invitations-inbox.js";

import type { SessionUser } from "../application/ports/session.js";
import type { FiltersChange } from "./event-filters.js";

/** Listing of the user's events, with search and date filtering. */
@customElement("planu-events-view")
export class PlanuEventsView extends LitElement {
	static override styles = css`
    :host {
      display: block;
      padding: var(--wa-space-l);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
      gap: var(--wa-space-l);
      margin-block-start: var(--wa-space-l);
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: var(--wa-space-m);
    }

    wa-select {
      flex: 0 1 14rem;
    }

    .empty {
      margin-block-start: var(--wa-space-2xl);
      text-align: center;
      color: var(--wa-color-text-quiet);
    }
  `;

	@consume({ context: eventsContext, subscribe: true })
	private eventsSnapshot: EventsSnapshot | undefined;

	/**
	 * Tells `firebase-provider.ts` whether this view is around to look at
	 * `eventsSnapshot`. See `eventsContext`'s doc comment in `context.ts`:
	 * without calling this, the subscription behind it would stay open on
	 * every route for the rest of the session instead of just this one.
	 */
	@consume({ context: eventsInterestContext, subscribe: true })
	private setEventsInterest: ((interested: boolean) => void) | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@state() private searchTerm = "";
	@state() private range: DateRange = {};
	@state() private ownership: OwnershipFilter = "all";
	@state() private tags: string[] = [];
	@state() private editorOpen = false;
	@state() private editing: StoredEvent | undefined;
	@state() private draft: Partial<PlanuEvent> | undefined;
	@state() private draftSource: InferenceSourceName | undefined;

	/**
	 * Whether `draft` is T33's sample event. Kept apart from `draftSource`
	 * because that field already means "it was generated, but where isn't
	 * known"; the sample wasn't generated at all, so reusing it would
	 * announce it as AI's work.
	 */
	@state() private draftIsSample = false;
	@state() private aiAvailable = false;

	/**
	 * The chosen order, recovered from the previous session. It's read at
	 * construction, not in `connectedCallback`, so the first render
	 * already comes out sorted the way the user left it and doesn't jump
	 * in front of their eyes.
	 */
	@state() private sort: SortPreference = readSortPreference();

	/**
	 * The chosen view, recovered from the previous session.
	 *
	 * It's read in the field initializer, just like the order, with the
	 * intention that the first render already comes out the way the user
	 * left it. **That intention has no oracle**: moving it to
	 * `connectedCallback` doesn't break any test, and a one-frame jump
	 * isn't something the suite knows how to check. It's left where it is
	 * for consistency with `sort` and because it costs nothing, not
	 * because it's been proven necessary.
	 */
	@state() private view: ViewMode = readViewMode();

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		// Opens the live subscription behind `eventsContext` — see that
		// context's doc comment in `context.ts` for why this view has to say
		// so explicitly instead of the subscription just always being open.
		this.setEventsInterest?.(true);
		// A button that always fails is worse than a button that isn't there.
		this.aiAvailable = canOffer(await checkAvailability());
	}

	/**
	 * Symmetric to `connectedCallback()` above: closes what it opened.
	 *
	 * A context-provided function call, not a bubbling DOM event:
	 * `disconnectedCallback()` runs after this element is already detached
	 * from the tree, with no parent left for an event to bubble through.
	 */
	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.setEventsInterest?.(false);
	}

	constructor() {
		super();
		// The card doesn't know about the editor: it emits and this view decides.
		// The monthly grid emits `planu-event-picked` when the user picks one
		// of the undated events that don't fit any cell, and it deliberately
		// doesn't decide what to do with it. Here it's decided: **open the
		// editor**, which is the same thing clicking the card does in the
		// card grid. The alternative —taking the calendar to the event's
		// month— doesn't exist: an undated event has no month to go to, and
		// giving it one is exactly what the user would have to decide in the
		// editor.
		for (const type of ["planu-edit-event", "planu-event-picked"]) {
			this.addEventListener(type, (domEvent) => {
				this.editing = (domEvent as CustomEvent<StoredEvent>).detail;
				this.editorOpen = true;
			});
		}
	}

	override render() {
		const all = this.eventsSnapshot?.events ?? [];
		const visible = filterEvents(
			all,
			this.searchTerm,
			this.range,
			this.ownership,
			this.user?.uid ?? "",
			this.tags,
		);

		const knownTags = collectTags(all);

		return html`
      <planu-invitations-inbox></planu-invitations-inbox>

      <div class="toolbar">
        <planu-event-filters
          .availableTags=${knownTags}
          @planu-filters-change=${this.#onFilters}
        ></planu-event-filters>

        <wa-radio-group
          class="views"
          label=${msg("View")}
          orientation="horizontal"
          .value=${this.view}
          @change=${this.#onView}
        >
          ${viewOptions().map(
						(option) =>
							html`<wa-radio appearance="button" value=${option.value}>
                ${option.label}
              </wa-radio>`,
					)}
        </wa-radio-group>

        <wa-select
          label=${msg("Sort by")}
          .value=${serializeSortPreference(this.sort)}
          @change=${this.#onSort}
        >
          ${sortOptions().map(
						(option) =>
							html`<wa-option value=${option.value}
                >${option.label}</wa-option
              >`,
					)}
        </wa-select>

        <!-- The agenda that gets exported is the one being viewed: the
				     same events that already went through the filters, **before**
				     grouping. If someone passes \`groups\` here instead of
				     \`visible\`, the .ics ends up with a single group and
				     nothing catches it: the unit tests use their own data and the
				     e2e only checks that a filter reduces things down to one
				     VEVENT. -->
        <planu-calendar-export
          mode="agenda"
          .events=${visible}
        ></planu-calendar-export>
        <wa-button variant="brand" @click=${this.#onNew}>
          ${msg("New event")}
        </wa-button>
      </div>

      ${this.#renderList(visible, all)}

      <planu-event-editor
        .knownTags=${knownTags}
        .open=${this.editorOpen}
        .event=${this.editing}
        .draft=${this.draft}
        .draftSource=${this.draftSource}
        ?isSample=${this.draftIsSample}
        ?isFirstEvent=${this.eventsSnapshot?.status === "ready" && all.length === 0}
        @planu-editor-close=${this.#onEditorClose}
      ></planu-event-editor>
    `;
	}

	#onEditorClose(): void {
		this.editorOpen = false;
		this.editing = undefined;
	}

	/**
	 * "Try a sample event" (T33): the draft is pre-filled with sample data
	 * and the same editor opens as for a manual entry or an AI one — the
	 * user reviews it and decides whether to save it, it never writes
	 * itself.
	 */
	#onEmptySample(): void {
		this.editing = undefined;
		this.draft = sampleEventDraft();
		this.draftSource = undefined;
		this.draftIsSample = true;
		this.editorOpen = true;
	}

	#renderList(visible: StoredEvent[], all: StoredEvent[]) {
		const state = listingState({
			status: this.eventsSnapshot?.status,
			total: all.length,
			visible: visible.length,
			ownership: this.ownership,
			narrowed: this.#narrowed,
		});
		if (state === "error") {
			return html`<wa-callout variant="danger" role="alert">
        ${msg(
					"Your events could not be loaded. Check your connection and reload.",
				)}
      </wa-callout>`;
		}
		if (state === "loading") return this.#renderSkeletons();
		if (state !== "list") return this.#renderEmpty(state);

		// `visible`, not `all`: **the filter belongs to the screen, not to
		// the card grid**. All three views hang off this same line and
		// receive the same thing, which is what makes it impossible for one
		// of them to end up unfiltered. And the "nothing matches" message
		// comes out before the split, for all three too: an empty calendar
		// doesn't explain why it's empty.
		//
		// `new Date()` here and not inside the domain: the clock is an
		// input, and this view is the boundary where it's read. `groupEvents`
		// and `buildAgenda` receive the instant, and that's how they can be
		// tested without depending on when the tests happen to run.
		//
		// It's read on every repaint and there's no timer, so an event that
		// ends while the page is open doesn't jump from "upcoming" to "past"
		// until the next render —a filter, a sort change, a snapshot—.
		// Deliberate: a `setInterval` to reorder the screen under the cursor
		// is more annoying than it is correct.
		const now = new Date();

		// The **interface's** language, not the browser's.
		//
		// `src/i18n/localization.ts` warns about this danger by its very
		// name, and `calendar-view` already obeys it: if the browser asks
		// for German, the interface serves English, and without passing the
		// locale, `Intl` would format the agenda's day headings in German
		// inside an English screen. It also goes to `groupEvents` because
		// the same value governs the collation of alphabetical order, and
		// having the two views sort differently would be the same kind of
		// divergence this review came to close.
		const locale = getLocale();

		if (this.view === "calendar") {
			// `heading-level="2"` because the page's tree is h1 planu → h2
			// group → h3 card, and the month takes the group's place.
			return html`<planu-calendar-view
        heading-level="2"
        .events=${visible}
        .sort=${this.sort}
        .locale=${locale}
      ></planu-calendar-view>`;
		}

		if (this.view === "agenda") {
			return html`<planu-agenda-view
        .agenda=${buildAgenda(visible, { now, sort: this.sort, locale })}
        ?narrowed=${this.#narrowed}
      ></planu-agenda-view>`;
		}

		return html`<planu-event-groups
      .groups=${groupEvents(visible, { now, sort: this.sort, locale })}
      ?narrowed=${this.#narrowed}
    ></planu-event-groups>`;
	}

	/**
	 * Whether the user has asked for something specific. Decides whether
	 * the past-events group comes out open (see `shouldRevealPast`) and
	 * also which "no results" message gets shown.
	 *
	 * A single source for both questions, and in `domain/`: they used to
	 * be duplicated and disagreed exactly on tags, so clicking the "music"
	 * tag and typing "music" —same intent, same results— would open the
	 * fold or not depending on which one you used.
	 */
	get #narrowed(): boolean {
		return isNarrowed({
			searchTerm: this.searchTerm,
			from: this.range.from,
			to: this.range.to,
			tags: this.tags,
		});
	}

	#renderSkeletons() {
		return html`<div class="grid">
      ${Array.from(
				{ length: 6 },
				() => html`<wa-skeleton style="height: 12rem"></wa-skeleton>`,
			)}
    </div>`;
	}

	/**
	 * "You don't have any events" and "your search finds nothing" are
	 * different problems, and so is the way out of each one.
	 */
	#renderEmpty(state: ListingState) {
		return html`<div class="empty">
      ${
				state !== "no-events"
					? html`<p>${this.#emptyFilteredMessage(state)}</p>`
					: html`<planu-empty-state
            ?aiAvailable=${this.aiAvailable}
            @planu-create-event=${this.#onNew}
            @planu-open-generator=${this.#onNew}
            @planu-try-sample=${this.#onEmptySample}
          ></planu-empty-state>`
			}
    </div>`;
	}

	/** "No results", explained by the filter that caused it: see `listingState`. */
	#emptyFilteredMessage(state: ListingState): string {
		if (state === "none-shared") {
			return msg("Nobody has shared an event with you yet.");
		}
		if (state === "none-mine") {
			return msg("You have not created any events yet.");
		}
		return msg("No events match your search, tags or date filter.");
	}

	#onFilters(event: Event): void {
		const detail = (event as CustomEvent<FiltersChange>).detail;
		this.searchTerm = detail.searchTerm;
		this.range = { from: detail.from, to: detail.to };
		this.ownership = detail.ownership;
		this.tags = detail.tags;
	}

	/**
	 * Reassigning `.value` on every render makes `wa-select` respond with
	 * `change`; without the guard, this would reassign the state, trigger
	 * another render and start all over again. It's the same loop already
	 * documented by the radio group in `event-filters.ts`.
	 */
	#onSort(domEvent: Event): void {
		const select = domEvent.target as HTMLElement & { value?: string };
		const chosen = parseSortPreference(select.value);
		if (sameSortPreference(chosen, this.sort)) return;

		this.sort = chosen;
		writeSortPreference(chosen);
	}

	/**
	 * Same as the order, and with the same guard: reassigning `.value` on
	 * every render makes `wa-radio-group` respond with `change`, and
	 * without comparing beforehand this would reassign the state, trigger
	 * another render and start all over again.
	 *
	 * The value goes through `parseViewMode` even though it comes from our
	 * own radios: it's the same sanitization applied to whatever arrives
	 * from `localStorage`, so there aren't two paths by which the state
	 * could end up with different values.
	 */
	#onView(domEvent: Event): void {
		const group = domEvent.target as HTMLElement & { value?: string };
		const chosen = parseViewMode(group.value);
		if (chosen === this.view) return;

		this.view = chosen;
		writeViewMode(chosen);
	}

	/**
	 * Also clears the draft. Without this, a sample or an AI generation
	 * cancelled without saving would stay in `this.draft` — the editor is a
	 * single instance that gets reused (see the `#tagGeneration` note in
	 * `event-editor.ts`) — and a later manual entry would reopen with that
	 * same data, with no warning as to why.
	 */
	#onNew(): void {
		this.editing = undefined;
		this.draft = undefined;
		this.draftSource = undefined;
		this.draftIsSample = false;
		this.editorOpen = true;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-events-view": PlanuEventsView;
	}
}
