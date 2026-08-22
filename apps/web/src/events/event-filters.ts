import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/checkbox-group/checkbox-group.js";
import "@awesome.me/webawesome/dist/components/checkbox/checkbox.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import type { DateRange, OwnershipFilter } from "../domain/filter-events.js";

export interface FiltersChange extends DateRange {
	searchTerm: string;
	ownership: OwnershipFilter;
	/** Combined with AND downstream: an event must carry all of them. */
	tags: string[];
}

/**
 * Reads the value from the native input that raised the event.
 *
 * `event.target.value` will not do: listening on the `wa-input` host, the
 * target arrives retargeted to the `wa-input` itself, whose `value` has not yet
 * synced with the inner input. The result is reading the previous value —
 * empty on the first keystroke — and filtering nothing.
 */
function readValue(event: globalThis.Event): string {
	const source = event.composedPath()[0] as HTMLInputElement | undefined;
	return source?.value ?? "";
}

/** Text search, date range, and which inbox to show. */
@customElement("planu-event-filters")
export class PlanuEventFilters extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		form {
			display: flex;
			flex-wrap: wrap;
			align-items: end;
			gap: var(--wa-space-m);
		}

		wa-input[type="search"] {
			flex: 1 1 16rem;
		}
	`;

	@state() private searchTerm = "";
	@state() private from = "";
	@state() private fromTime = "";
	@state() private to = "";
	@state() private toTime = "";
	@state() private ownership: OwnershipFilter = "all";
	@state() private tags: string[] = [];

	/** The tags the user already uses. Empty means no tag filter is offered. */
	@property({ attribute: false }) availableTags: readonly string[] = [];

	override render() {
		const filtered =
			this.searchTerm !== "" ||
			this.from !== "" ||
			this.to !== "" ||
			this.ownership !== "all" ||
			this.tags.length > 0;

		return html`
			<form role="search" @submit=${this.#onSubmit}>
				<wa-input
					type="search"
					name="search"
					label=${msg("Search")}
					placeholder=${msg("Title or description")}
					enterkeyhint="search"
					.value=${this.searchTerm}
					@input=${this.#onSearch}
				></wa-input>

				<wa-radio-group
					label=${msg("Show")}
					orientation="horizontal"
					.value=${this.ownership}
					@change=${this.#onOwnership}
				>
					<wa-radio appearance="button" value="all">${msg("All")}</wa-radio>
					<wa-radio appearance="button" value="mine">${msg("Mine")}</wa-radio>
					<wa-radio appearance="button" value="shared">
						${msg("Shared with me")}
					</wa-radio>
				</wa-radio-group>

				<wa-input
					type="date"
					name="from"
					label=${msg("From")}
					.value=${this.from}
					@change=${this.#onFrom}
				></wa-input>

				<wa-input
					type="time"
					name="fromTime"
					label=${msg("From time")}
					.value=${this.fromTime}
					@change=${this.#onFromTime}
				></wa-input>

				<wa-input
					type="date"
					name="to"
					label=${msg("To")}
					.value=${this.to}
					@change=${this.#onTo}
				></wa-input>

				<wa-input
					type="time"
					name="toTime"
					label=${msg("To time")}
					.value=${this.toTime}
					@change=${this.#onToTime}
				></wa-input>

				${this.#renderTags()}

				${
					filtered
						? html`<wa-button appearance="plain" @click=${this.#clear}>
								${msg("Clear filters")}
							</wa-button>`
						: null
				}
			</form>
		`;
	}

	/**
	 * Tags are offered as checkboxes and not as toggle buttons.
	 *
	 * A button that's sometimes "pressed" requires `aria-pressed` and
	 * explaining to the user that they accumulate; a checkbox already means
	 * that, and the group gives it an accessible name without inventing
	 * anything. They combine with **AND**, and the group's text says so,
	 * because that isn't what people expect by default.
	 *
	 * Two details that aren't style, they're correctness:
	 *
	 * `.checked` with `live()` and not `?checked`. In `wa-checkbox` the
	 * **attribute** `checked` maps to `defaultChecked`, so `?checked` writes
	 * the initial value and not the current one — and as soon as the user
	 * clicks once, the component ignores the initial value forever. With
	 * that, "Clear filters" unfiltered the listing and left the checkboxes
	 * painted as checked. And `live()` on top of `.checked` because Lit
	 * compares against the last thing *it* painted, not against what the
	 * user left in the DOM.
	 *
	 * `repeat()` keyed by tag. `availableTags` comes from the events and
	 * reorders itself when one is created. With a key, Lit **moves** each
	 * tag's node instead of rewriting whatever's at that position, and
	 * whoever is navigating by keyboard stays on the checkbox they had
	 * focused instead of ending up on a different tag. Everything else
	 * —the checked state and the label— gets reapplied by `live()` and the
	 * *bindings* even without a key: an earlier comment blamed the key for
	 * a labeling bug that nobody has managed to reproduce. What does break
	 * without it is covered by the test "reordering doesn't move the focus
	 * of someone navigating by keyboard".
	 *
	 * The available ones **plus the selected ones** get painted. Editing
	 * an event can leave the last tag being filtered by unused:
	 * `availableTags` loses it, its checkbox disappears from the DOM and
	 * the filter stays active and invisible, with an empty listing and
	 * nothing checked to explain it. It's painted instead of pruning
	 * `this.tags` because pruning changes the filter without the user
	 * asking for it —and silently widens the result—; showing it checked
	 * leaves the decision where it was, one click away from being undone.
	 */
	#renderTags() {
		const shown = [...new Set([...this.availableTags, ...this.tags])];
		if (shown.length === 0) return nothing;

		return html`<wa-checkbox-group
			label=${msg("Tags")}
			hint=${msg("An event must have all the tags you pick.")}
			orientation="horizontal"
		>
			${repeat(
				shown,
				(tag) => tag,
				(tag) => html`<wa-checkbox
					value=${tag}
					.checked=${live(this.tags.includes(tag))}
					@change=${() => this.#toggleTag(tag)}
				>${tag}</wa-checkbox>`,
			)}
		</wa-checkbox-group>`;
	}

	#toggleTag(tag: string): void {
		this.tags = this.tags.includes(tag)
			? this.tags.filter((each) => each !== tag)
			: [...this.tags, tag];
		this.#emit();
	}

	/** The form never navigates: filtering is live. */
	#onSubmit(event: SubmitEvent): void {
		event.preventDefault();
	}

	#onSearch(event: globalThis.Event): void {
		this.searchTerm = readValue(event);
		this.#emit();
	}

	#onFrom(event: globalThis.Event): void {
		this.from = readValue(event);
		this.#emit();
	}

	#onFromTime(event: globalThis.Event): void {
		this.fromTime = readValue(event);
		this.#emit();
	}

	#onTo(event: globalThis.Event): void {
		this.to = readValue(event);
		this.#emit();
	}

	#onToTime(event: globalThis.Event): void {
		this.toTime = readValue(event);
		this.#emit();
	}

	/**
	 * Re-emitting on an unchanged value locks the interface up. Rendering
	 * reassigns `.value` on the radio group, the group answers with `change`,
	 * this handler emits, the listing re-renders, and round it goes.
	 */
	#onOwnership(event: globalThis.Event): void {
		const group = event.target as HTMLElement & { value?: string };
		const chosen = (group.value ?? "all") as OwnershipFilter;
		if (chosen === this.ownership) return;

		this.ownership = chosen;
		this.#emit();
	}

	#clear(): void {
		this.searchTerm = "";
		this.from = "";
		this.fromTime = "";
		this.to = "";
		this.toTime = "";
		this.ownership = "all";
		this.tags = [];
		this.#emit();
	}

	#emit(): void {
		this.dispatchEvent(
			new CustomEvent<FiltersChange>("planu-filters-change", {
				detail: {
					searchTerm: this.searchTerm,
					ownership: this.ownership,
					// An empty date input is "", which as a Date would be invalid.
					// An empty time means the whole day, same as before this field
					// existed: "00:00:00" for the start of the range and "23:59:59"
					// for its end — exactly today's default, so no regression for
					// anyone who never touches these two fields. A time that is
					// present rounds to the start of that minute for "from" and the
					// end of it for "to": a "to" of 20:00 still catches something
					// that happened at 20:00:30.
					from: this.from
						? new Date(`${this.from}T${this.fromTime || "00:00"}:00`)
						: null,
					to: this.to
						? new Date(`${this.to}T${this.toTime || "23:59"}:59`)
						: null,
					tags: [...this.tags],
				},
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-filters": PlanuEventFilters;
	}
}
