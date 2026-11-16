import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/option/option.js";
import "@awesome.me/webawesome/dist/components/select/select.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { userContext } from "../../application/context.js";
import {
	type AnalyticsPort,
	analyticsContext,
	noopAnalytics,
} from "../../application/ports/analytics.js";
import type { SessionUser } from "../../application/ports/session.js";
import {
	type SharingPort,
	sharingContext,
} from "../../application/ports/sharing.js";
import type { EventRole, StoredEvent } from "../../domain/event.js";
import { buildInvitationMessage } from "../../domain/invitation-message.js";
import { webAwesomeStyles } from "../../styles/web-awesome.js";
import { AccessList, type Person } from "./access-list.js";
import { accessRowStyles, renderOwner, renderPerson } from "./access-rows.js";
import { buildInvitationLink } from "./invitation-link.js";
import { canManageMembers } from "./permissions.js";

/** Matches the cap in firestore.rules. */
const MAX_GUESTS = 20;

/**
 * Whether a `wa-hide` / `wa-after-hide` is the dialog's own. Web Awesome
 * dispatches them bubbling and composed, so closing the role select or a
 * guest's menu reached the dialog too and closed it, losing what was typed.
 */
function isOwnEvent(domEvent: Event): boolean {
	return domEvent.target === domEvent.currentTarget;
}

/** Invite people to an event, change a guest's role, and remove them. */
@customElement("planu-share-dialog")
export class PlanuShareDialog extends LitElement {
	static override styles = [
		webAwesomeStyles,
		css`
		form {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: start;
			gap: var(--wa-space-s);
			margin-block-end: var(--wa-space-l);
		}

		/* The role hint makes the select taller than its neighbours, so the row
		   aligns to the top and the button is pushed down past the labels. */
		form > wa-button {
			margin-block-start: var(--wa-space-xl);
		}

		/* The three fields drop to their own rows before the email input gets too
		   narrow to read what you typed. */
		@media (max-width: 30rem) {
			form {
				grid-template-columns: 1fr;
			}

			form > wa-button {
				margin-block-start: 0;
			}
		}

		h3 {
			margin: 0 0 var(--wa-space-s);
			font-size: var(--wa-font-size-m);
		}

		/* native.css zeroes a paragraph's margins; the gap to the list above and
		   to what follows is spelled out here. */
		.empty {
			margin-block: var(--wa-space-m);
			color: var(--wa-color-text-normal);
		}

		.live {
			margin-block-end: var(--wa-space-m);
		}

		.live:empty {
			margin: 0;
		}

		.actions {
			margin-block-end: var(--wa-space-l);
		}
	`,
		accessRowStyles,
	];

	@property({ type: Boolean }) open = false;

	@property({ attribute: false }) event!: StoredEvent;

	@consume({ context: sharingContext, subscribe: true })
	private sharing: SharingPort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@consume({ context: analyticsContext, subscribe: true })
	private analytics: AnalyticsPort = noopAnalytics;

	readonly #access = new AccessList(this, {
		getSharing: () => this.sharing,
		getEvent: () => this.event,
		getUser: () => this.user,
	});

	@state() private busy = false;
	@state() private error = "";
	@state() private notice = "";

	/** Who was just removed. Lives in a live region that is always rendered. */
	@state() private announcement = "";

	/**
	 * What «Invite again» needs about the person just removed. Captured before
	 * the write: neither the tombstone nor the reloaded event keeps the role.
	 */
	@state() private reinvite:
		| { uid: string; role: EventRole; email: string | undefined }
		| undefined;

	/** The member whose "Remove access" is waiting for its answer. */
	@state() private confirmingKey: string | undefined;

	#focusAfterRemoval: { key: string; index: number } | undefined;

	/**
	 * What the owner can send to the person just invited. planu mails nobody
	 * (ADR 0012): this is the owner's own mail client, clipboard or share sheet.
	 */
	@state() private handoff:
		| { subject: string; mailto: string; link: string }
		| undefined;

	@state() private copied = false;

	/**
	 * Whether the body is in the DOM: from opening until the hide animation
	 * ends. Every card mounts a closed dialog, and an always-rendered form
	 * put two fields per card in the page that nobody could reach — Chrome
	 * flagged each `wa-select`'s inner inputs and the email field.
	 */
	@state() private mounted = false;

	override willUpdate(changed: Map<string, unknown>): void {
		if (this.open) this.mounted = true;
		// Also on `event`: the card can hand over a fresh snapshot while the
		// dialog is open, and listening only to `open` left the list showing
		// membership that had already changed underneath it.
		if ((changed.has("open") || changed.has("event")) && this.open) {
			this.error = "";
			this.notice = "";
			this.handoff = undefined;
			this.copied = false;
			this.#access.reset();
			void this.#access.load();
			this.confirmingKey = undefined;
		}
		// Not on `event`: the snapshot of the removal itself must not silence it.
		if (changed.has("open")) {
			this.announcement = "";
			this.reinvite = undefined;
		}
	}

	override updated(): void {
		// Waits for the row to be really gone: the new snapshot lands after the write.
		const target = this.#focusAfterRemoval;
		if (!target || this.#access.loading) return;
		if (this.#access.people.some((person) => person.key === target.key)) return;
		this.#focusAfterRemoval = undefined;
		(
			this.#triggerAt(target.index) ?? this.shadowRoot?.querySelector("h3")
		)?.focus();
	}

	override render() {
		const { event, user } = this;
		if (!event || !user || !canManageMembers(event, user.uid)) return nothing;

		return html`
			<wa-dialog
				label=${msg(str`Share “${event.title}”`)}
				.open=${this.open}
				@wa-hide=${this.#close}
				@wa-after-hide=${this.#onAfterHide}
			>
				${this.mounted ? this.#renderBody(user) : nothing}
			</wa-dialog>
		`;
	}

	#onAfterHide(domEvent: Event): void {
		if (!isOwnEvent(domEvent)) return;
		this.mounted = false;
	}

	#renderBody(user: SessionUser) {
		return html`
				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}
				${
					this.notice
						? html`<wa-callout variant="success" role="status">${this.notice}</wa-callout>`
						: nothing
				}
				<div class="live" role="status">${this.announcement}</div>
				${
					this.reinvite
						? html`<wa-button
								class="live"
								data-action="reinvite"
								size="s"
								appearance="outlined"
								?disabled=${this.busy}
								@click=${this.#reinviteRemoved}
							>
								${msg("Invite again")}
							</wa-button>`
						: nothing
				}

				<form @submit=${this.#onInvite}>
					<wa-input
						name="email"
						type="email"
						autocomplete="off"
						label=${msg("Invite by email")}
						required
						enterkeyhint="done"
					></wa-input>
					<wa-select
						name="role"
						label=${msg("Role")}
						hint=${msg("Viewer: can see the event. Editor: can also change its details. Neither can invite, remove people or delete the event.")}
						value="viewer"
					>
						<wa-option value="viewer">${msg("Viewer")}</wa-option>
						<wa-option value="editor">${msg("Editor")}</wa-option>
					</wa-select>
					<wa-button type="submit" variant="brand" ?disabled=${this.busy}>
						${msg("Invite")}
					</wa-button>
				</form>
				${this.#renderHandoff()}

				<h3 tabindex="-1">${msg("People with access")}</h3>
				<ul class="wa-list-plain">
					${renderOwner(user)}
					${this.#access.people.map((person) =>
						renderPerson(
							person,
							this.busy,
							this.#onAction,
							person.key === this.confirmingKey
								? {
										onConfirm: () => void this.#confirmRemove(person),
										onCancel: () => this.#cancelRemove(person),
									}
								: undefined,
						),
					)}
				</ul>
				${
					// Whoever signs up with the address can claim an offer (GH-192).
					this.#access.offers.length > 0
						? html`<h3>${msg("Offers by email")}</h3>
								<ul class="wa-list-plain">
									${this.#access.offers.map(
										(offer) => html`<li>
											<span>${offer.inviteeEmail}</span>
											<span>${offer.role === "editor" ? msg("Editor") : msg("Viewer")}</span>
											<wa-button
												data-action="withdraw-offer"
												size="s"
												appearance="outlined"
												?disabled=${this.busy}
												@click=${() => void this.#withdrawOffer(offer.id)}
											>
												${msg("Withdraw offer")}
											</wa-button>
										</li>`,
									)}
								</ul>`
						: nothing
				}
				${
					// Three different things, told apart. Saying "only you" while the
					// list is still resolving told the owner of a twenty-guest event
					// that it was shared with nobody.
					this.#access.loading
						? html`<p class="empty">${msg("Loading…")}</p>`
						: this.#access.people.length === 0
							? html`<p class="empty">${msg("Only you, for now.")}</p>`
							: nothing
				}
				${
					this.#access.incomplete
						? html`<wa-callout variant="warning" role="status">
								${msg("Pending invitations could not be loaded, so this list may be incomplete.")}
							</wa-callout>`
						: nothing
				}
		`;
	}

	#renderHandoff() {
		const { handoff } = this;
		if (!handoff) return nothing;

		return html`
			<div class="actions wa-cluster">
				<wa-button data-action="email" href=${handoff.mailto}>
					${msg("Send by email")}
				</wa-button>
				<wa-button data-action="copy" @click=${this.#copyLink}>
					${msg("Copy link")}
				</wa-button>
				${
					// Share only where the browser can; everywhere else Copy covers it.
					typeof navigator.share === "function"
						? html`<wa-button data-action="share" @click=${this.#shareLink}>
								${msg("Share")}
							</wa-button>`
						: nothing
				}
				<span role="status">${this.copied ? msg("Link copied.") : nothing}</span>
			</div>
		`;
	}

	readonly #copyLink = async (): Promise<void> => {
		const { handoff } = this;
		if (!handoff) return;
		// Each attempt starts unconfirmed: a copy that worked earlier says
		// nothing about this one.
		this.copied = false;
		try {
			await navigator.clipboard.writeText(handoff.link);
			this.error = "";
			this.copied = true;
		} catch {
			this.error = msg("The link could not be copied.");
		}
	};

	readonly #shareLink = async (): Promise<void> => {
		const { handoff } = this;
		if (!handoff) return;
		try {
			await navigator.share({ title: handoff.subject, url: handoff.link });
		} catch (error) {
			// Closing the sheet is a choice, not a failure.
			if (error instanceof DOMException && error.name === "AbortError") return;
			await this.#copyLink();
		}
	};

	readonly #onAction = (person: Person, domEvent: Event): void => {
		const value = (domEvent as CustomEvent<{ item: { value: string } }>).detail
			.item.value;

		if (value === "remove") {
			if (person.pending) void this.#cancelInvite(person);
			else this.#askRemove(person);
			return;
		}
		if (value !== person.role) {
			void this.#changeRole(person, value as EventRole);
		}
	};

	#atCapacity(): boolean {
		return (
			(this.event.memberIds?.length ?? 1) +
				this.#access.people.filter((person) => person.pending).length >
			MAX_GUESTS
		);
	}

	async #onInvite(domEvent: SubmitEvent): Promise<void> {
		domEvent.preventDefault();

		const { sharing, event, user } = this;
		if (!sharing || !event || !user || this.busy) return;

		// Captured before any await: by the time the write resolves Lit has
		// re-rendered, `domEvent.target` is null, and calling reset() on it threw
		// — which skipped the reload right after it and left the list stale.
		const form = domEvent.target as HTMLFormElement;
		const data = new FormData(form);
		const email = String(data.get("email") ?? "").trim();
		const role = String(data.get("role") ?? "viewer") as EventRole;
		if (!email) return;

		this.error = "";
		this.notice = "";
		this.handoff = undefined;
		this.copied = false;
		this.busy = true;
		try {
			// A rejection is a failed lookup, not "no account": it lands in the
			// catch below.
			const invited = await sharing.findUserByEmail(email);

			if (invited?.uid === event.userId) {
				this.error = msg("You already own this event.");
				return;
			}

			if (invited && event.memberIds?.includes(invited.uid)) {
				this.error = msg("That person is already in this event.");
				return;
			}

			// Counting members alone oversubscribes: with 19 guests and 5 live
			// invitations, the first to accept gets in and the rest are told to
			// try again for something retrying will never fix.
			if (this.#atCapacity()) {
				this.error = msg("This event has reached its limit of guests.");
				return;
			}

			// An offer, not a membership. They join when they accept; until then
			// nothing of this event reaches them. With no account the offer waits
			// by email, and the notice below is the same either way so it does
			// not reveal whether the address is registered (ADR 0012).
			const offer = {
				eventId: event.id,
				eventTitle: event.title,
				inviteeEmail: email,
				invitedBy: user.uid,
				invitedByName: user.displayName ?? "",
				role,
			};
			if (invited) {
				await sharing.inviteToEvent({ ...offer, inviteeUid: invited.uid });
			} else {
				await sharing.offerInviteByEmail(offer);
			}
		} catch {
			this.error = msg("The invitation could not be saved. Please try again.");
			return;
		} finally {
			this.busy = false;
		}

		// Deliberately outside the `try`: the invitation is already saved, and a
		// failure while refreshing the list must not end up telling the user it
		// was not. Reporting failure for something that did happen invites the
		// obvious reaction — doing it again.
		this.notice = msg("Invitation sent. They join once they accept it.");
		const link = buildInvitationLink(window.location.origin, event.id);
		const message = buildInvitationMessage({
			eventTitle: event.title,
			link,
			role,
			to: email,
		});
		this.handoff = {
			subject: message.subject,
			mailto: message.mailto,
			link,
		};
		this.analytics.trackShare({ editable: role === "editor" });
		form.reset();
		await this.#access.load().catch(() => {});
	}

	/**
	 * A pending offer has no membership to change yet: the role lives on the
	 * invitation until someone accepts it, so that is what gets rewritten.
	 */
	async #changeRole(person: Person, role: EventRole): Promise<void> {
		if (!person.pending) {
			await this.#write({
				memberIds: this.event.memberIds ?? [],
				roles: { ...this.event.roles, [person.uid]: role },
			});
			return;
		}

		const { sharing } = this;
		if (!sharing || this.busy) return;

		this.error = "";
		this.notice = "";
		this.busy = true;
		try {
			await sharing.changeInviteRole(person.key, role);
		} catch {
			this.error = msg("The change could not be saved. Please try again.");
		} finally {
			this.busy = false;
			await this.#access.load().catch(() => {});
		}
	}

	#askRemove(person: Person): void {
		this.confirmingKey = person.key;
		void this.updateComplete.then(() =>
			this.shadowRoot
				?.querySelector<HTMLElement>("[data-action=cancel-remove]")
				?.focus(),
		);
	}

	#cancelRemove(person: Person): void {
		this.confirmingKey = undefined;
		const index = this.#access.people.findIndex((p) => p.key === person.key);
		void this.updateComplete.then(() => this.#triggerAt(index)?.focus());
	}

	#triggerAt(index: number): HTMLElement | undefined {
		return this.shadowRoot?.querySelectorAll<HTMLElement>(
			"wa-dropdown [slot=trigger]",
		)[index];
	}

	async #confirmRemove(person: Person): Promise<void> {
		if (this.busy) return;
		const roles = { ...this.event.roles };
		delete roles[person.uid];

		this.confirmingKey = undefined;
		this.#focusAfterRemoval = {
			key: person.key,
			index: this.#access.people.findIndex((p) => p.key === person.key),
		};
		// Read before the write: afterwards the role is gone from the event.
		const role = this.event.roles?.[person.uid] ?? "viewer";
		const removed = await this.#write(
			{
				memberIds: (this.event.memberIds ?? []).filter(
					(uid) => uid !== person.uid,
				),
				roles,
			},
			person.uid,
		);
		if (removed) {
			this.announcement = msg(
				str`Access removed for ${person.name}. They are not notified.`,
			);
			this.reinvite = { uid: person.uid, role, email: removed.email };
		} else {
			this.#focusAfterRemoval = undefined;
		}
	}

	readonly #reinviteRemoved = async (): Promise<void> => {
		const { sharing, event, user, reinvite } = this;
		if (!sharing || !event || !user || !reinvite || this.busy) return;

		this.error = "";
		if (this.#atCapacity()) {
			this.error = msg("This event has reached its limit of guests.");
			return;
		}
		this.busy = true;
		try {
			await sharing.restoreAccessOffer(event.id, reinvite.uid, reinvite.role, {
				invitedByName: user.displayName ?? "",
				...(reinvite.email ? { inviteeEmail: reinvite.email } : {}),
			});
			this.reinvite = undefined;
			this.announcement = msg("Invitation sent again.");
		} catch {
			this.error = msg("The invitation could not be saved. Please try again.");
		} finally {
			this.busy = false;
			await this.#access.load().catch(() => {});
		}
	};

	async #cancelInvite(person: Person): Promise<void> {
		const { sharing } = this;
		if (!sharing || this.busy) return;

		this.error = "";
		this.notice = "";
		this.busy = true;
		try {
			await sharing.revokeInvite(person.key);
		} catch {
			this.error = msg("The change could not be saved. Please try again.");
		} finally {
			this.busy = false;
			await this.#access.load().catch(() => {});
		}
	}

	async #withdrawOffer(id: string): Promise<void> {
		const { sharing } = this;
		if (!sharing || this.busy) return;

		this.error = "";
		this.notice = "";
		this.busy = true;
		try {
			await sharing.revokeEmailOffer(id);
		} catch {
			this.error = msg("The change could not be saved. Please try again.");
		} finally {
			this.busy = false;
			await this.#access.load().catch(() => {});
		}
	}

	async #write(
		membership: { memberIds: string[]; roles: Record<string, EventRole> },
		removedUid?: string,
	): Promise<{ email: string | undefined } | undefined> {
		const { sharing, event } = this;
		if (!sharing || !event || this.busy) return undefined;

		this.error = "";
		this.notice = "";
		this.announcement = "";
		this.reinvite = undefined;
		this.busy = true;
		try {
			const email = await sharing.updateEventMembership(
				event.id,
				membership,
				removedUid,
			);
			return { email };
		} catch {
			this.error = msg("The change could not be saved. Please try again.");
			return undefined;
		} finally {
			this.busy = false;
			// Reloaded on both paths. Lit will not re-commit a value that has not
			// changed from its point of view, so after a failed role change the
			// control keeps showing the role that was never saved.
			await this.#access.load().catch(() => {});
		}
	}

	#close(domEvent: Event): void {
		if (!isOwnEvent(domEvent)) return;
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-share-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-share-dialog": PlanuShareDialog;
	}
}
