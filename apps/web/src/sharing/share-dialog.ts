import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
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
import { userContext } from "../firebase/context.js";
import type { EventRole, StoredEvent } from "../lib/types.js";
import { type Person, toPeople } from "./access-list.js";
import { canManageMembers } from "./permissions.js";

/** Matches the cap in firestore.rules. */
const MAX_GUESTS = 20;

/** Invite people to an event, change a guest's role, and remove them. */
@customElement("planu-share-dialog")
export class PlanuShareDialog extends LitElement {
	static override styles = css`
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

		ul {
			display: flex;
			flex-direction: column;
			margin: 0;
			padding: 0;
			list-style: none;
		}

		li {
			display: flex;
			align-items: center;
			gap: var(--wa-space-s);
			padding-block: var(--wa-space-xs);
		}

		/* The avatar is a flex item too, and without this it is the first thing
		   to give when the row runs out of room: a circle squeezed horizontally
		   turns into an oval and reads as broken. */
		wa-avatar {
			flex: 0 0 auto;
		}

		/* Takes the slack so the trailing control stays put, and the zero minimum
		   size lets it shrink: without that, a long name pushes the control off
		   the edge instead of ellipsing. */
		.identity {
			flex: 1 1 auto;
			min-inline-size: 0;
		}

		.name {
			display: block;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		/* The theme's quiet text token measures 4.33:1 on this surface, under the
		   4.5:1 AA asks for text this size — axe fails it. The hierarchy here
		   comes from the smaller size instead of from washing out the colour. */
		.detail {
			display: block;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			font-size: var(--wa-font-size-s);
			color: var(--wa-color-text-normal);
		}

		/* Keeps every row the same shape: whatever the state, the trailing
		   control sits at the same place and never wraps under the name. */
		.trailing {
			display: flex;
			flex: 0 0 auto;
			align-items: center;
			gap: var(--wa-space-xs);
		}

		/* Not a control: the owner's role cannot be changed by anyone. */
		.owner-role {
			color: var(--wa-color-text-normal);
			font-size: var(--wa-font-size-s);
			white-space: nowrap;
		}

		.empty {
			color: var(--wa-color-text-normal);
		}

		/* Web Awesome's wa-visually-hidden utility is a global class and does not
		   cross into this shadow root, so the screen-reader text was rendering in
		   plain sight. Same technique, declared where it applies. */
		.sr-only {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
			border: 0;
		}
	`;

	@property({ type: Boolean }) open = false;

	@property({ attribute: false }) event!: StoredEvent;

	@consume({ context: sharingContext, subscribe: true })
	private sharing: SharingPort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@consume({ context: analyticsContext, subscribe: true })
	private analytics: AnalyticsPort = noopAnalytics;

	@state() private people: Person[] = [];
	@state() private loading = false;
	/** Set when the pending query failed: the list is short and says so. */
	@state() private incomplete = false;
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
			// Cleared first, or reopening for another event flashes the previous
			// event's people while the new ones resolve.
			this.people = [];
			this.loading = true;
			this.incomplete = false;
			void this.#load();
		}
	}

	/**
	 * Members and pending invitations, in one list.
	 *
	 * Names are resolved when the dialog opens and never stored on the event: if
	 * someone changes theirs, the new one shows up with nothing to migrate.
	 *
	 * Pending invitations are queried by `invitedBy` because that is what the
	 * rule allows the owner to read, then narrowed to this event here. Filtering
	 * by `eventId` in the query would need a composite index and would not be
	 * readable anyway.
	 */
	async #load(): Promise<void> {
		const { sharing, event, user } = this;
		if (!sharing || !event || !user) {
			// Or the dialog sits on "Loading…" forever when it opens before the
			// contexts have arrived.
			this.loading = false;
			return;
		}

		const memberUids = (event.memberIds ?? []).filter(
			(uid) => uid !== event.userId,
		);

		// Decided invitations now survive in Firestore instead of being
		// deleted, so this must be narrowed to `pending` explicitly: an
		// accepted one would otherwise show its person twice, once as a
		// member and once as a stale offer, and a declined one would keep
		// offering "cancel" on something already answered.
		const invited = await sharing
			.listPendingInvites(event.id, user.uid)
			.catch(() => null);

		// Swallowing this left the owner looking at a list with no pending
		// invitations in it and no hint that any were missing — and that list is
		// what they decide who to remove from.
		this.incomplete = invited === null;

		const profiles = await sharing.findProfiles([
			...memberUids,
			...(invited ?? []).map((row) => row.inviteeUid),
		]);

		this.loading = false;
		this.people = toPeople(event, memberUids, invited ?? [], profiles);
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
					${this.#renderOwner(user)}
					${this.people.map((person) => this.#renderPerson(person))}
				</ul>
				${
					// Three different things, told apart. Saying "only you" while the
					// list is still resolving told the owner of a twenty-guest event
					// that it was shared with nobody.
					this.loading
						? html`<p class="empty">${msg("Loading…")}</p>`
						: this.people.length === 0
							? html`<p class="empty">${msg("Only you, for now.")}</p>`
							: nothing
				}
				${
					this.incomplete
						? html`<wa-callout variant="warning" role="status">
								${msg("Pending invitations could not be loaded, so this list may be incomplete.")}
							</wa-callout>`
						: nothing
				}
			</wa-dialog>
		`;
	}

	/** You, first and unchangeable. Seeing yourself listed makes the list read. */
	#renderOwner(user: SessionUser) {
		return html`
			<li>
				<wa-avatar
					image=${user.photoURL ?? ""}
					label=""
					aria-hidden="true"
				></wa-avatar>
				<span class="identity">
					<span class="name">${user.displayName || msg("You")}</span>
					<span class="detail">${user.email ?? ""}</span>
				</span>
				<span class="trailing">
					<span class="owner-role">${msg("Owner")}</span>
				</span>
			</li>
		`;
	}

	/**
	 * One person, with everything you can do to them behind a single control.
	 *
	 * Role and removal live in the same menu rather than a select plus a button:
	 * the button carried the person's name to be distinguishable, which made
	 * every row a wall of repeated text.
	 */
	#renderPerson(person: Person) {
		return html`
			<li>
				<wa-avatar
					image=${person.photoURL}
					label=""
					aria-hidden="true"
				></wa-avatar>
				<span class="identity">
					<span class="name">${person.name}</span>
					${
						// Only what the trailing control cannot say. Repeating the role
						// here made every row say it twice.
						//
						// The address goes on the rows that have not accepted yet, which
						// is exactly when the name is least useful: someone who has never
						// signed in has no published profile, so the row would read
						// "Guest" and identify nobody.
						person.pending
							? html`<span class="detail">${person.email}</span>`
							: nothing
					}
				</span>

				<span class="trailing">
					${
						// The state is a badge and not a line of text: it keeps every row
						// the same height, and it says the same thing about anyone —
						// there is no grammatical gender to get wrong.
						person.pending
							? html`<wa-badge variant="neutral">${msg("Pending")}</wa-badge>`
							: nothing
					}
				<wa-dropdown
					@wa-select=${(domEvent: Event) => this.#onAction(person, domEvent)}
				>
					<wa-button
						slot="trigger"
						appearance="plain"
						.withCaret=${true}
						?disabled=${this.busy}
					>
						<span class="sr-only">
							${msg(str`Access for ${person.name}`)}
						</span>
						${person.role === "editor" ? msg("Editor") : msg("Viewer")}
					</wa-button>

					<wa-dropdown-item
						type="checkbox"
						value="viewer"
						?checked=${person.role === "viewer"}
					>
						${msg("Viewer")}
					</wa-dropdown-item>
					<wa-dropdown-item
						type="checkbox"
						value="editor"
						?checked=${person.role === "editor"}
					>
						${msg("Editor")}
					</wa-dropdown-item>
					<wa-divider></wa-divider>
					<wa-dropdown-item value="remove" variant="danger">
						${person.pending ? msg("Cancel invitation") : msg("Remove access")}
					</wa-dropdown-item>
				</wa-dropdown>
				</span>
			</li>
		`;
	}

	#onAction(person: Person, domEvent: Event): void {
		const value = (domEvent as CustomEvent<{ item: { value: string } }>).detail
			.item.value;

		if (value === "remove") {
			void (person.pending ? this.#cancelInvite(person) : this.#remove(person));
			return;
		}
		if (value !== person.role) {
			void this.#changeRole(person, value as EventRole);
		}
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
				this.people.filter((person) => person.pending).length;
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
		await this.#load().catch(() => {});
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
			await this.#load().catch(() => {});
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
			await this.#load().catch(() => {});
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
			await this.#load().catch(() => {});
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
