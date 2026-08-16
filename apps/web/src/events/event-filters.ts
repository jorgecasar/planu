import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import { msg } from "@lit/localize";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { DateRange, OwnershipFilter } from "./filter-events.js";

export interface FiltersChange extends DateRange {
	searchTerm: string;
	ownership: OwnershipFilter;
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
	@state() private to = "";
	@state() private ownership: OwnershipFilter = "all";

	override render() {
		const filtered =
			this.searchTerm !== "" ||
			this.from !== "" ||
			this.to !== "" ||
			this.ownership !== "all";

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
					type="date"
					name="to"
					label=${msg("To")}
					.value=${this.to}
					@change=${this.#onTo}
				></wa-input>

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

	#onTo(event: globalThis.Event): void {
		this.to = readValue(event);
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
		this.to = "";
		this.ownership = "all";
		this.#emit();
	}

	#emit(): void {
		this.dispatchEvent(
			new CustomEvent<FiltersChange>("planu-filters-change", {
				detail: {
					searchTerm: this.searchTerm,
					ownership: this.ownership,
					// An empty date input is "", which as a Date would be invalid.
					from: this.from ? new Date(`${this.from}T00:00:00`) : null,
					to: this.to ? new Date(`${this.to}T23:59:59`) : null,
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
