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
import {
	type AnalyticsPort,
	analyticsContext,
	noopAnalytics,
} from "../application/ports/analytics.js";
import type { SessionUser } from "../application/ports/session.js";
import {
	type SharingPort,
	sharingContext,
} from "../application/ports/sharing.js";
import { userContext } from "../infrastructure/firebase/context.js";
import type { EventRole, StoredEvent } from "../lib/types.js";
import { AccessList, type Person } from "./access-list.js";
import { accessRowStyles, renderOwner, renderPerson } from "./access-rows.js";
import { canManageMembers } from "./permissions.js";

/** Matches the cap in firestore.rules. */
const MAX_GUESTS = 20;

/** Invite people to an event, change a guest's role, and remove them. */
@customElement("planu-share-dialog")
export class PlanuShareDialog extends LitElement {
	static override styles = [
		css`
		form {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: end;
			gap: var(--wa-space-s);
			margin-block-end: var(--wa-space-l);
		}

		/* The three fields drop to their own rows before the email input gets too
		   narrow to read what you typed. */
		@media (max-width: 30rem) {
			form {
				grid-template-columns: 1fr;
			}
		}

		h3 {
			margin: 0 0 var(--wa-space-s);
			font-size: var(--wa-font-size-m);
		}

		.empty {
			color: var(--wa-color-text-normal);
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

	override willUpdate(changed: Map<string, unknown>): void {
		// Also on `event`: the card can hand over a fresh snapshot while the
		// dialog is open, and listening only to `open` left the list showing
		// membership that had already changed underneath it.
		if ((changed.has("open") || changed.has("event")) && this.open) {
			this.error = "";
			this.notice = "";
			this.#access.reset();
			void this.#access.load();
		}
	}

	override render() {
		const { event, user } = this;
		if (!event || !user || !canManageMembers(event, user.uid)) return nothing;

		return html`
			<wa-dialog
				label=${msg(str`Share “${event.title}”`)}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
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

				<form @submit=${this.#onInvite}>
					<wa-input
						name="email"
						type="email"
						label=${msg("Invite by email")}
						required
						enterkeyhint="done"
					></wa-input>
					<wa-select name="role" label=${msg("Role")} value="viewer">
						<wa-option value="viewer">${msg("Viewer")}</wa-option>
						<wa-option value="editor">${msg("Editor")}</wa-option>
					</wa-select>
					<wa-button type="submit" variant="brand" ?disabled=${this.busy}>
						${msg("Invite")}
					</wa-button>
				</form>

				<h3>${msg("People with access")}</h3>
				<ul>
					${renderOwner(user)}
					${this.#access.people.map((person) =>
						renderPerson(person, this.busy, this.#onAction),
					)}
				</ul>
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
			</wa-dialog>
		`;
	}

	readonly #onAction = (person: Person, domEvent: Event): void => {
		const value = (domEvent as CustomEvent<{ item: { value: string } }>).detail
			.item.value;

		if (value === "remove") {
			void (person.pending ? this.#cancelInvite(person) : this.#remove(person));
			return;
		}
		if (value !== person.role) {
			void this.#changeRole(person, value as EventRole);
		}
	};

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
			const committed =
				(event.memberIds?.length ?? 1) +
				this.#access.people.filter((person) => person.pending).length;
			if (committed > MAX_GUESTS) {
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

	async #remove(person: Person): Promise<void> {
		const roles = { ...this.event.roles };
		delete roles[person.uid];

		await this.#write(
			{
				memberIds: (this.event.memberIds ?? []).filter(
					(uid) => uid !== person.uid,
				),
				roles,
			},
			person.uid,
		);
	}

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

	async #write(
		membership: { memberIds: string[]; roles: Record<string, EventRole> },
		removedUid?: string,
	): Promise<void> {
		const { sharing, event } = this;
		if (!sharing || !event || this.busy) return;

		this.error = "";
		this.notice = "";
		this.busy = true;
		try {
			await sharing.updateEventMembership(event.id, membership, removedUid);
		} catch {
			this.error = msg("The change could not be saved. Please try again.");
		} finally {
			this.busy = false;
			// Reloaded on both paths. Lit will not re-commit a value that has not
			// changed from its point of view, so after a failed role change the
			// control keeps showing the role that was never saved.
			await this.#access.load().catch(() => {});
		}
	}

	#close(): void {
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-share-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-share-dialog": PlanuShareDialog;
	}
}
