import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/details/details.js";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { StoredEvent } from "../domain/event.js";
import { formatEventTime } from "../domain/format-dates.js";
import {
	keyTarget,
	sameMonth,
	shiftMonth,
	startOfMonth,
} from "../domain/grid-keyboard.js";
import type { SortPreference } from "../domain/sort-events.js";
import { getLocale } from "../i18n/localization.js";
import { webAwesomeStyles } from "../styles/web-awesome.js";
import {
	buildMonthGrid,
	dayKey,
	firstDayOfWeek,
	type MonthCell,
} from "./month-grid.js";

/**
 * Month grid: a month, its complete weeks, and each day's events.
 *
 * It receives events already filtered by ownership and doesn't talk to
 * anyone else. The switcher between views is a separate task; here only the
 * month is painted.
 *
 * **No calendar library**: CSS grid for the shape and `Intl.DateTimeFormat`
 * for the names. Spreading events across cells lives in `month-grid.ts`, as
 * a pure function, which is where the daylight saving time change can be
 * tested without mounting anything.
 *
 * The keyboard follows the APG `grid` pattern, not an invention of our own:
 * arrows to move by days and weeks, `Home` and `End` for the ends of the
 * week, `Page Up` and `Page Down` to change month, and **a single tab stop**
 * with roving focus —`tabindex="0"` on the active cell and `-1` on the
 * rest—. The alternative, 42 tabbable cells, would force 42 keystrokes to
 * cross the calendar.
 */
@customElement("planu-calendar-view")
export class PlanuCalendarView extends LitElement {
	static override styles = [
		webAwesomeStyles,
		css`
		:host {
			display: block;
		}

		/*
		 * Title first, navigation after it. On a phone the three buttons don't
		 * fit beside the month name —"Next month" used to spill past the
		 * margin— so the row wraps and the navigation takes a line of its own.
		 */
		.toolbar {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--wa-space-2xs) var(--wa-space-s);
			margin-block-end: var(--wa-space-s);
		}

		.nav {
			display: flex;
			align-items: center;
			gap: var(--wa-space-2xs);
		}

		@media (max-width: 40rem) {
			.nav {
				flex: 1 1 100%;
				justify-content: space-between;
				/* The theme token buttons pad with, narrowed so the three fit. */
				--wa-form-control-padding-inline: var(--wa-space-xs);
			}
		}

		/*
		 * The title is deliberately not a heading: the level it would deserve
		 * depends on where the view switcher mounts it, and fixing it here
		 * would break the page's heading order. The grid is named with
		 * aria-labelledby, which is what someone navigating with a screen
		 * reader needs.
		 */
		.title {
			margin: 0;
			font-size: var(--wa-font-size-l);
			font-weight: var(--wa-font-weight-heading);
		}

		.grid {
			display: grid;
			grid-template-columns: repeat(7, minmax(0, 1fr));
			gap: var(--wa-border-width-s);
			border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
			background-color: var(--wa-color-surface-border);
		}

		/*
		 * The rows exist for the accessibility tree —role="grid" requires
		 * role="row"— but must not generate a box: with display: contents the
		 * cells become children of the CSS grid and the seven columns line up.
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

		/*
		 * Today's number is a brand pill badge. Every day number gets the same
		 * line box —the plain number's own height— so the badge's padding
		 * doesn't push today's events lower than the rest of the week.
		 */
		.day {
			box-sizing: border-box;
			block-size: calc(var(--wa-font-size-s) * var(--wa-line-height-normal));
		}

		wa-badge.day {
			align-self: start;
		}

		ul {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-2xs);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		/* A card doesn't fit in a month cell: one-line entries. */
		li {
			overflow: hidden;
			border-radius: var(--wa-border-radius-m);
			padding-inline: var(--wa-space-2xs);
			background-color: var(--wa-color-surface-border);
			font-size: var(--wa-font-size-s);
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		/* On a phone a one-line title is cut to nothing: wrap it, up to three lines. */
		@media (max-width: 40rem) {
			li {
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 3;
				line-clamp: 3;
				white-space: normal;
				overflow-wrap: anywhere;
			}
		}

		/*
		 * A multi-day event runs into the cell edge on the side it continues,
		 * flat instead of rounded, so consecutive days read as one bar.
		 */
		li.from-before {
			margin-inline-start: calc(-1 * var(--wa-space-2xs));
			border-start-start-radius: 0;
			border-end-start-radius: 0;
		}

		li.to-after {
			margin-inline-end: calc(-1 * var(--wa-space-2xs));
			border-start-end-radius: 0;
			border-end-end-radius: 0;
		}

		.undated {
			margin-block: var(--wa-space-s) 0;
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		.undated ul {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-2xs);
			margin: 0;
			padding: 0;
			list-style: none;
		}
	`,
	];

	/** The events to spread across cells, already filtered by whoever mounts the view. */
	@property({ attribute: false }) events: readonly StoredEvent[] = [];

	/**
	 * The visible month. It's both input and position at once: navigating
	 * reassigns it, so whoever mounts the view can read it to know where it is.
	 */
	@property({ attribute: false }) month: Date = startOfMonth(new Date());

	/** What day today is. Passed as a parameter so tests don't depend on the clock. */
	@property({ attribute: false }) today: Date = new Date();

	/** Locale to use. Empty means whatever the interface is currently serving. */
	@property() locale = "";

	/**
	 * How to sort within each cell. The same criterion as the agenda and the
	 * cards, so a three-day conference doesn't come out in one order in the
	 * grid and another in the agenda.
	 */
	@property({ attribute: false }) sort: SortPreference | undefined;

	/**
	 * Level of the month's heading. `0` —the default value— leaves a paragraph.
	 *
	 * The level can't be fixed here: it depends on where the grid is mounted,
	 * and in the listing the tree is `h1 planu` → `h2 group` → `h3 card`, so
	 * there the month is an `h2`. Fixing an `h2` inside the component would
	 * break it anywhere else, and not setting one leaves the month out of
	 * heading navigation. That's why whoever mounts it says so.
	 */
	@property({ type: Number, attribute: "heading-level" }) headingLevel = 0;

	/** The day with roving focus. */
	@state() private focused: Date = new Date();

	/** What's announced when the month changes. Empty until the first change. */
	@state() private announcement = "";

	/**
	 * Focus is only returned to the grid when the keyboard itself moved it.
	 * Doing it on every render would steal it from the user every time a new
	 * event arrives through the property.
	 */
	#refocus = false;

	/**
	 * Reattaches the roving focus to the visible month.
	 *
	 * It's needed because the month can also change from the outside, and a
	 * focus pointing at another month would leave the grid without a single
	 * `tabindex="0"` cell: forty-two cells and not one tab stop, that is, a
	 * calendar outside the keyboard's reach.
	 *
	 * Today is preferred when it falls within range, which is the day the
	 * user expects to find when opening a calendar.
	 */
	override willUpdate(): void {
		if (this.#sameMonth(this.focused)) return;

		this.focused = this.#sameMonth(this.today)
			? new Date(this.today.getTime())
			: startOfMonth(this.month);
	}

	#sameMonth(date: Date): boolean {
		return sameMonth(date, this.month);
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
				${this.#renderTitle(grid.title)}

				<div class="nav">
					<wa-button
						appearance="plain"
						@click=${() => this.#focus(shiftMonth(this.focused, this.month, -1))}
					>${msg("Previous month")}</wa-button>
					<wa-button
						appearance="outlined"
						@click=${() => this.#focus(new Date(this.today.getTime()))}
					>${msg("Today")}</wa-button>
					<wa-button
						appearance="plain"
						@click=${() => this.#focus(shiftMonth(this.focused, this.month, 1))}
					>${msg("Next month")}</wa-button>
				</div>
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
								<span class="wa-visually-hidden">${weekday.long}</span>
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

			<div class="wa-visually-hidden" role="status">${this.announcement}</div>
		`;
	}

	/**
	 * The month's title, with whatever level whoever mounts the view has
	 * given it.
	 *
	 * A `switch` with literal labels and not `unsafeStatic`: there are only
	 * two levels that make sense here, and a static template built from a
	 * property is an injection path that doesn't need opening for two cases.
	 * The `id` is the same in all three, because it's what names the grid via
	 * `aria-labelledby`.
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
	 * Undated events, reachable and not just counted.
	 *
	 * This used to be a paragraph saying how many there were, and with that an
	 * undated event was announced but unreachable: the user knew it existed
	 * and had no way to get to it from here. Now they're listed, each with
	 * its own button, and picking one emits `planu-event-picked` so that
	 * whoever mounts the view decides what to do —opening the editor is the
	 * natural choice, but that's up to whoever mounts it, not up to the
	 * grid—.
	 *
	 * They go in a collapsed `wa-details`: they're secondary compared to the
	 * month, and expanded they would push the grid off the screen as soon as
	 * there are a few of them.
	 */
	#renderUndated(undated: readonly StoredEvent[]) {
		if (undated.length === 0) return nothing;

		return html`<wa-details class="undated" summary=${this.#undatedNotice(undated.length)}>
			<ul class="wa-list-plain">
				${undated.map(
					(event) => html`<li>
						<wa-button
							appearance="plain"
							size="s"
							@click=${() => this.#pick(event)}
						>${event.title}</wa-button>
					</li>`,
				)}
			</ul>
		</wa-details>`;
	}

	/** The grid doesn't know what to do with an event: it just says so. */
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
	 * The hour in front of the title, or nothing.
	 *
	 * Only if the event has an hour (`!allDay`) and only on the day it
	 * **starts**: a three-day conference doesn't repeat "9:00" on the other
	 * two, because there that's not when it happens, just a day it's still
	 * ongoing.
	 */
	#eventTime(event: StoredEvent, cellKey: number, locale: string): string {
		if (event.allDay || !event.startDate) return "";
		if (dayKey(event.startDate) !== cellKey) return "";
		return formatEventTime(event.startDate, locale);
	}

	/**
	 * A cell.
	 *
	 * The full date goes as the first content, hidden from view, not as
	 * `aria-label`: the label would cover the events' titles, and then the
	 * reader would say the day but not what happens on it.
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
				<span class="wa-visually-hidden">${cell.label}</span>
				${
					cell.isToday
						? html`<wa-badge class="day" variant="brand" pill aria-hidden="true"
								>${cell.day}</wa-badge
							>`
						: html`<span class="day" aria-hidden="true">${cell.day}</span>`
				}
				${
					cell.events.length > 0
						? html`<ul class="wa-list-plain">
								${cell.events.map((event, index) => {
									const time = this.#eventTime(event, cell.key, locale);
									const flow = cell.continuation[index];
									return html`<li
										class=${classMap({
											"from-before": !!flow?.fromBefore,
											"to-after": !!flow?.toAfter,
										})}
									>${
										flow?.fromBefore
											? html`<span class="wa-visually-hidden">${msg("Continued:")} </span>`
											: nothing
									}${time ? `${time} ` : ""}${event.title}</li>`;
								})}
							</ul>`
						: nothing
				}
			</div>
		`;
	}

	/**
	 * The notice for undated events.
	 *
	 * They don't fit in the calendar —a cell is a date— but simply making
	 * them disappear would write them off as lost, so it says how many there
	 * are. Two forms and not one interpolation: the whole sentence changes
	 * between singular and plural.
	 */
	#undatedNotice(count: number): string {
		return count === 1
			? msg("1 event without a date is not shown on the calendar")
			: msg(str`${count} events without a date are not shown on the calendar`);
	}

	/**
	 * Clicking a cell moves the tab stop there.
	 *
	 * And if that cell was filler from another month, the **actual focus**
	 * also needs to be returned. The template doesn't carry keys, so Lit
	 * reuses nodes by position: when the new month repaints, the node the
	 * user just clicked stays focused but now holds a different day. Clicking
	 * July 1 from June, the `tabindex="0"` went to July 1 but the focus
	 * stayed on the node, which now held July 29: the next arrow key jumped
	 * twenty-seven days, leaving a screen reader on a cell it had said
	 * nothing about.
	 *
	 * The reattachment goes here and not inside `#focus()` because the
	 * toolbar buttons also go through there, and those shouldn't steal the
	 * focus.
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

	/** Where the focus lands is decided in `grid-keyboard.ts`; here it's moved. */
	#onKeydown(domEvent: KeyboardEvent): void {
		const first = firstDayOfWeek(this.locale || getLocale());
		const target = keyTarget(domEvent, this.focused, this.month, first);
		if (!target) return;
		this.#focus(target);

		// Only after having recognized the key: the arrows scroll the page and
		// `Page Down` skips it entirely, and both things happening at once is
		// disorienting.
		domEvent.preventDefault();
		this.#refocus = true;
	}

	/** Moves the focus to a day, changing the month and announcing it if needed. */
	#focus(date: Date): void {
		const changed = !this.#sameMonth(date);
		this.focused = date;
		if (!changed) return;

		this.month = startOfMonth(date);

		// The month lives in a separate `role="status"` and not in the visible
		// title: marking the title as a live region would also announce it on
		// the first paint, when nobody has changed anything.
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
