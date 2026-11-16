import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/tag/tag.js";
import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	eventRepositoryContext,
	userContext,
} from "../../application/context.js";
import type { EventRepositoryPort } from "../../application/ports/event-repository.js";
import type { SessionUser } from "../../application/ports/session.js";
import type { StoredEvent } from "../../domain/event.js";
import {
	canDelete,
	canEdit,
	canLeave,
	canManageMembers,
	roleFor,
} from "../sharing/permissions.js";
import "../sharing/share-dialog.js";
import { isExportable } from "../../domain/build-ics.js";
import { dateBlockParts, formatEventDates } from "../../domain/format-dates.js";
import { tagHue } from "../../domain/tags.js";
import { getLocale } from "../../i18n/localization.js";
import { webAwesomeStyles } from "../../styles/web-awesome.js";
import { downloadEventFile, openInGoogleCalendar } from "./calendar-export.js";
import { tagChipStyles } from "./tag-styles.js";

/** Font Awesome Free 6 «ellipsis» (CC BY 4.0), inline for the same reason
 * `landing.ts` gives: `<wa-icon>` fetches from an origin the CSP blocks. */
const ELLIPSIS_PATH =
	"M8 256a56 56 0 1 1 112 0A56 56 0 1 1 8 256zm160 0a56 56 0 1 1 112 0 56 56 0 1 1 -112 0zm216-56a56 56 0 1 1 0 112 56 56 0 1 1 0-112z";

/** Card for an event, with edit and delete actions. */
@customElement("planu-event-card")
export class PlanuEventCard extends LitElement {
	static override styles = [
		webAwesomeStyles,
		tagChipStyles,
		css`
		:host {
			display: block;
		}

		/* h3, not h2: since T19 the card always lives inside a group, and that
		   group has an h2 with its own name. With h2 here, the event would end
		   up as a *sibling* of its group (h1 → h2 Upcoming → h2 Concert), and
		   navigating by headings gave no structure at all. Headings cross the
		   shadow DOM boundary, so the level is counted across components, not
		   within each one. */
		h3 {
			margin: 0;
			font-size: var(--wa-font-size-l);
		}

		img {
			inline-size: 100%;
			block-size: 10rem;
			object-fit: cover;
		}

		p {
			margin: 0 0 var(--wa-space-s);
		}

		/* The card leads with when, then what (GH-188). */
		.heading {
			display: flex;
			align-items: flex-start;
			gap: var(--wa-space-m);
		}

		.title-block {
			display: grid;
			gap: var(--wa-space-2xs);
			min-inline-size: 0;
		}

		.date-block {
			flex: none;
			display: grid;
			place-content: center;
			justify-items: center;
			inline-size: 3.5rem;
			min-block-size: 3.5rem;
			border-radius: var(--wa-border-radius-m);
			background: var(--wa-color-brand-fill-quiet);
			color: var(--wa-color-brand-on-quiet);
			line-height: var(--wa-line-height-condensed);
		}

		.date-block .day {
			font-size: var(--wa-font-size-xl);
			font-weight: var(--wa-font-weight-bold);
			font-variant-numeric: tabular-nums;
		}

		.date-block .month {
			font-size: var(--wa-font-size-xs);
			text-transform: uppercase;
		}

		.date-block.undated {
			background: var(--wa-color-neutral-fill-quiet);
			color: var(--wa-color-neutral-on-quiet);
			font-size: var(--wa-font-size-xs);
		}

		/* The whole card opens the editor without nesting controls: the title
		   is the one button, and its ::after stretches over the card. The
		   footer's own controls sit above that layer and keep their clicks. */
		wa-card {
			position: relative;
		}

		.open {
			all: unset;
			cursor: pointer;
		}

		.open::after {
			content: "";
			position: absolute;
			inset: 0;
			border-radius: var(--wa-panel-border-radius);
		}

		/* One wrapper lifts all footer controls above the title's layer. */
		.actions {
			position: relative;
			z-index: 1;
		}

		/* wa-dropdown is display: contents, so the margin goes on its
		   trigger, which is the actual flex item. */
		.actions [slot="trigger"] {
			margin-inline-start: auto;
		}

		/* Two lines are a preview; the editor holds the rest. */
		.description {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			overflow: hidden;
			line-height: var(--wa-line-height-normal);
		}

		/* Not a definition list: it's two lines of metadata. A <dl> with
		   <div> that don't contain dt/dd is invalid and axe flags it. */
		.meta {
			display: grid;
			gap: var(--wa-space-2xs);
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		/* An actual list, not a handful of <span>: a screen reader announces
		   how many there are. */
		.tags {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-2xs);
			margin: var(--wa-space-s) 0 0;
			padding: 0;
			list-style: none;
		}

		`,
	];

	@property({ attribute: false }) event!: StoredEvent;

	@consume({ context: eventRepositoryContext, subscribe: true })
	private eventRepository: EventRepositoryPort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@state() private confirming = false;
	@state() private deleting = false;
	@state() private sharing = false;
	@state() private leaving = false;
	@state() private confirmingLeave = false;
	@state() private error = "";

	/**
	 * Kept apart from `error`, which is only ever painted inside the delete
	 * dialog. Leaving reported its failures into that same field, where nothing
	 * renders them unless the delete dialog happens to be open — so a failed
	 * leave was completely silent.
	 */
	@state() private leaveError = "";

	/** With no session there are no permissions; `roleFor` returns `null`. */
	get #uid(): string {
		return this.user?.uid ?? "";
	}

	/**
	 * Whose event this is, when it is not the viewer's.
	 *
	 * Without it, a shared event looks like your own and its missing Delete
	 * button reads as a bug.
	 */
	#renderRoleBadge() {
		const role = roleFor(this.event, this.#uid);
		if (role === "owner" || role === null) return nothing;

		return html`<wa-badge variant="neutral">
			${role === "editor" ? msg("Shared: you can edit") : msg("Shared: view only")}
		</wa-badge>`;
	}

	/**
	 * Day and month first, so a list of cards scans by date (GH-188). Hidden
	 * from assistive technology: the full period is read after the title.
	 */
	#renderDateBlock() {
		const date = this.event.startDate ?? this.event.endDate;
		if (!date) {
			return html`<span class="date-block undated" aria-hidden="true">
				${msg("No date")}
			</span>`;
		}
		const { day, month } = dateBlockParts(date, getLocale());
		return html`<span class="date-block" aria-hidden="true">
			<span class="day">${day}</span>
			<span class="month">${month}</span>
		</span>`;
	}

	/** All but «Edit» behind one «⋯» menu named after the event (GH-188):
	 * seven cards used to read «Edit, Share, Delete» with nothing apart. */
	#renderActions() {
		const { event } = this;
		const uid = this.#uid;
		const items = [
			// Only dated events can be exported, so only they offer it.
			isExportable(event)
				? html`<wa-dropdown-item value="calendar">
						${msg("Add to calendar")}
						<wa-dropdown-item slot="submenu" value="ics">
							${msg("Download .ics file")}
						</wa-dropdown-item>
						<wa-dropdown-item slot="submenu" value="google">
							${msg("Add to Google Calendar")}
						</wa-dropdown-item>
					</wa-dropdown-item>`
				: nothing,
			canManageMembers(event, uid)
				? html`<wa-dropdown-item value="share">${msg("Share")}</wa-dropdown-item>`
				: nothing,
			canLeave(event, uid)
				? html`<wa-dropdown-item value="leave" ?disabled=${this.leaving}>
						${msg("Leave")}
					</wa-dropdown-item>`
				: nothing,
			canDelete(event, uid)
				? html`<wa-dropdown-item value="delete" variant="danger">
						${msg("Delete")}
					</wa-dropdown-item>`
				: nothing,
		].filter((item) => item !== nothing);
		if (items.length === 0) return nothing;

		return html`<wa-dropdown
			placement="bottom-end"
			@wa-select=${this.#onAction}
		>
			<wa-button slot="trigger" appearance="plain">
				<svg width="1em" height="1em" fill="currentColor" viewBox="0 0 448 512" aria-hidden="true">
					<path d=${ELLIPSIS_PATH}></path>
				</svg>
				<span class="wa-visually-hidden">
					${msg(str`More actions for “${event.title}”`)}
				</span>
			</wa-button>
			${items}
		</wa-dropdown>`;
	}

	#onAction(domEvent: Event): void {
		const { value } = (domEvent as CustomEvent<{ item: { value: string } }>)
			.detail.item;
		if (value === "ics") downloadEventFile(this.event);
		else if (value === "google") openInGoogleCalendar(this.event);
		else if (value === "share") this.#openShare();
		else if (value === "leave") this.#askLeave();
		else if (value === "delete") this.#askDelete();
	}

	/** Why the hash only decides the hue, in `tag-styles.ts`. */
	#renderTags() {
		const { tags } = this.event;
		if (tags.length === 0) return nothing;

		return html`<ul class="wa-list-plain tags" aria-label=${msg("Tags")}>
			${tags.map(
				(tag) => html`<li>
					<wa-tag
						size="s"
						style=${`--hue: ${tagHue(tag)}`}
					>${tag}</wa-tag>
				</li>`,
			)}
		</ul>`;
	}

	override render() {
		const { event } = this;
		return html`
			<wa-card>
				${
					event.imageUrl
						? html`<img slot="media" src=${event.imageUrl} alt="" />`
						: nothing
				}

				<div slot="header" class="heading">
					${this.#renderDateBlock()}
					<div class="title-block">
						<h3>${
							canEdit(event, this.#uid)
								? html`<button
										type="button"
										class="open"
										tabindex="-1"
										@click=${this.#onEdit}
									>
										${event.title}
									</button>`
								: event.title
						}</h3>
						<div class="meta">
							<span>${formatEventDates(event.startDate, event.endDate, event.allDay)}</span>
							${event.location ? html`<span>${event.location}</span>` : nothing}
						</div>
					</div>
				</div>

				${event.description ? html`<p class="description">${event.description}</p>` : nothing}

				${this.#renderTags()}

				<div slot="footer" class="actions wa-cluster wa-gap-xs">
					${this.#renderRoleBadge()}
					${
						canEdit(event, this.#uid)
							? html`<wa-button appearance="plain" @click=${this.#onEdit}>
									${msg("Edit")}
									<span class="wa-visually-hidden">${event.title}</span>
								</wa-button>`
							: nothing
					}
					${this.#renderActions()}
				</div>

				${
					this.leaveError
						? html`<wa-callout variant="danger" role="alert">
								${this.leaveError}
							</wa-callout>`
						: nothing
				}
			</wa-card>

			<wa-dialog
				label=${msg("Leave event")}
				.open=${this.confirmingLeave}
				@wa-hide=${this.#cancelLeave}
			>
				<p>
					${msg(str`You will stop seeing “${event.title}”. Its owner would have to invite you again.`)}
				</p>
				<wa-button slot="footer" appearance="outlined" @click=${this.#cancelLeave}>
					${msg("Cancel")}
				</wa-button>
				<wa-button
					slot="footer"
					variant="danger"
					?disabled=${this.leaving}
					@click=${this.#leave}
				>
					${this.leaving ? msg("Leaving…") : msg("Leave")}
				</wa-button>
			</wa-dialog>

			${
				canManageMembers(event, this.#uid)
					? html`<planu-share-dialog
							.event=${event}
							.open=${this.sharing}
							@planu-share-close=${this.#closeShare}
						></planu-share-dialog>`
					: nothing
			}

			<wa-dialog
				label=${msg("Delete event")}
				.open=${this.confirming}
				@wa-hide=${this.#cancelDelete}
			>
				<p>${msg(str`This permanently deletes “${event.title}”. It cannot be undone.`)}</p>
				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}
				<wa-button slot="footer" appearance="outlined" @click=${this.#cancelDelete}>
					${msg("Cancel")}
				</wa-button>
				<wa-button
					slot="footer"
					variant="danger"
					?disabled=${this.deleting}
					@click=${this.#confirmDelete}
				>
					${this.deleting ? msg("Deleting…") : msg("Delete")}
				</wa-button>
			</wa-dialog>
		`;
	}

	#onEdit(): void {
		this.dispatchEvent(
			new CustomEvent("planu-edit-event", {
				detail: this.event,
				bubbles: true,
				composed: true,
			}),
		);
	}

	#openShare(): void {
		this.sharing = true;
	}

	#closeShare(): void {
		this.sharing = false;
	}

	/**
	 * Remove yourself from someone else's event.
	 *
	 * The write sends exactly what the rule expects from a leaver: their uid
	 * out of `memberIds` and `roles`, and nothing else. See ADR 0006.
	 */
	#askLeave(): void {
		this.confirmingLeave = true;
	}

	#cancelLeave(): void {
		this.confirmingLeave = false;
	}

	async #leave(): Promise<void> {
		const { eventRepository, event } = this;
		if (!eventRepository || this.leaving) return;

		this.leaveError = "";
		this.leaving = true;
		try {
			await eventRepository.leave(event.id, this.#uid);
			this.confirmingLeave = false;
		} catch {
			this.leaveError = msg("You could not be removed from this event.");
			this.confirmingLeave = false;
		} finally {
			this.leaving = false;
		}
	}

	#askDelete(): void {
		this.confirming = true;
	}

	#cancelDelete(): void {
		this.confirming = false;
	}

	async #confirmDelete(): Promise<void> {
		if (!this.eventRepository) return;

		this.deleting = true;
		this.error = "";
		try {
			await this.eventRepository.delete(this.event.id, this.#uid);
			this.confirming = false;
		} catch {
			// Without this catch the promise was rejected unhandled: the dialog
			// stayed open, the spinner stopped, and the user had no idea why
			// nothing was happening.
			this.error = msg("The event could not be deleted. Please try again.");
		} finally {
			this.deleting = false;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-card": PlanuEventCard;
	}
}
