import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/tag/tag.js";
import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { EventRepositoryPort } from "../application/ports/event-repository.js";
import type { SessionUser } from "../application/ports/session.js";
import { eventRepositoryContext, userContext } from "../firebase/context.js";
import type { StoredEvent } from "../lib/types.js";
import {
	canDelete,
	canEdit,
	canLeave,
	canManageMembers,
	roleFor,
} from "../sharing/permissions.js";
import "../sharing/share-dialog.js";
import "./calendar-export.js";
import { formatEventDates } from "../domain/format-dates.js";
import { tagHue } from "../domain/tags.js";
import { tagChipStyles } from "./tag-styles.js";

/** Card for an event, with edit and delete actions. */
@customElement("planu-event-card")
export class PlanuEventCard extends LitElement {
	static override styles = [
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

		return html`<wa-badge slot="footer" variant="neutral">
			${role === "editor" ? msg("Shared: you can edit") : msg("Shared: view only")}
		</wa-badge>`;
	}

	/** Why the hash only decides the hue, in `tag-styles.ts`. */
	#renderTags() {
		const { tags } = this.event;
		if (tags.length === 0) return nothing;

		return html`<ul class="tags" aria-label=${msg("Tags")}>
			${tags.map(
				(tag) => html`<li>
					<wa-tag
						size="small"
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

				<h3 slot="header">${event.title}</h3>

				${event.description ? html`<p>${event.description}</p>` : nothing}

				<div class="meta">
					${event.location ? html`<span>${event.location}</span>` : nothing}
					<span>${formatEventDates(event.startDate, event.endDate, event.allDay)}</span>
				</div>

				${this.#renderTags()}

					${this.#renderRoleBadge()}

				<planu-calendar-export
					slot="footer"
					.events=${[event]}
				></planu-calendar-export>

				${
					canEdit(event, this.#uid)
						? html`<wa-button
								slot="footer"
								appearance="plain"
								@click=${this.#onEdit}
							>
								${msg("Edit")}
							</wa-button>`
						: nothing
				}
				${
					canManageMembers(event, this.#uid)
						? html`<wa-button
								slot="footer"
								appearance="plain"
								@click=${this.#openShare}
							>
								${msg("Share")}
							</wa-button>`
						: nothing
				}
				${
					canDelete(event, this.#uid)
						? html`<wa-button
								slot="footer"
								appearance="plain"
								variant="danger"
								@click=${this.#askDelete}
							>
								${msg("Delete")}
							</wa-button>`
						: nothing
				}
				${
					canLeave(event, this.#uid)
						? html`<wa-button
								slot="footer"
								appearance="plain"
								?disabled=${this.leaving}
								@click=${this.#askLeave}
							>
								${msg("Leave")}
							</wa-button>`
						: nothing
				}

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
			await this.eventRepository.delete(this.event.id);
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
