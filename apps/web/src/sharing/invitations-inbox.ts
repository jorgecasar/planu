import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import type { DocumentData, Firestore } from "firebase/firestore";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionUser } from "../application/ports/session.js";
import {
	type SharingPort,
	sharingContext,
} from "../application/ports/sharing.js";
import { CollectionController } from "../firebase/collection-controller.js";
import { firestoreContext, userContext } from "../firebase/context.js";
import type { EventRole } from "../lib/types.js";
import { declineInvite, type EventInvite, invitesFor } from "./invitations.js";

/** Invitations waiting on this person, above their own events. */
@customElement("planu-invitations-inbox")
export class PlanuInvitationsInbox extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		ul {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);
			margin: 0 0 var(--wa-space-l);
			padding: 0;
			list-style: none;
		}

		.actions {
			display: flex;
			gap: var(--wa-space-xs);
			margin-block-start: var(--wa-space-xs);
		}
	`;

	@consume({ context: firestoreContext, subscribe: true })
	private firestore: Firestore | undefined;

	@consume({ context: sharingContext, subscribe: true })
	private sharing: SharingPort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@state() private busyWith = "";
	@state() private error = "";

	readonly #invites = new CollectionController<DocumentData>(this);

	/** Rebuilding the query on every update would resubscribe in a loop. */
	#queryKey: string | undefined;

	override willUpdate(): void {
		const { firestore, user } = this;
		const key = firestore && user ? user.uid : "";
		if (key === this.#queryKey) return;
		this.#queryKey = key;

		this.#invites.setQuery(
			firestore && user ? invitesFor(firestore, user.uid) : null,
		);
	}

	override render() {
		const invites = this.#invites.data.map(toInvite);
		if (invites.length === 0) return nothing;

		return html`
			${
				this.error
					? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
					: nothing
			}
			<ul>
				${invites.map((invite) => this.#renderInvite(invite))}
			</ul>
		`;
	}

	#renderInvite(invite: EventInvite) {
		const who = invite.invitedByName || msg("Someone");
		const busy = this.busyWith === invite.id;

		return html`
			<li>
				<wa-callout variant="brand">
					${
						invite.role === "editor"
							? msg(str`${who} invited you to edit “${invite.eventTitle}”.`)
							: msg(str`${who} invited you to see “${invite.eventTitle}”.`)
					}
					<div class="actions">
						<wa-button
							variant="brand"
							?disabled=${busy}
							@click=${() => this.#accept(invite)}
						>
							${msg("Accept")}
						</wa-button>
						<wa-button
							appearance="plain"
							?disabled=${busy}
							@click=${() => this.#decline(invite)}
						>
							${msg("Decline")}
						</wa-button>
					</div>
				</wa-callout>
			</li>
		`;
	}

	async #accept(invite: EventInvite): Promise<void> {
		await this.#run(invite, (_, sharing) => sharing.acceptInvite(invite));
	}

	async #decline(invite: EventInvite): Promise<void> {
		await this.#run(invite, async (firestore) => {
			await declineInvite(firestore, invite);
		});
	}

	async #run(
		invite: EventInvite,
		action: (firestore: Firestore, sharing: SharingPort) => Promise<void>,
	): Promise<void> {
		const { firestore, sharing } = this;
		if (!firestore || !sharing || this.busyWith) return;

		this.error = "";
		this.busyWith = invite.id;
		try {
			await action(firestore, sharing);
		} catch {
			this.error = msg("That did not work. Please try again.");
		} finally {
			this.busyWith = "";
		}
	}
}

/**
 * Firestore hands back loose data; only well-formed invitations are shown.
 *
 * The query already filters to `status == 'pending'`, so this inbox never
 * needs to render a decided one — that view belongs to the invitations page.
 */
function toInvite(document: DocumentData & { id: string }): EventInvite {
	return {
		id: document["id"],
		eventId: String(document["eventId"] ?? ""),
		eventTitle: String(document["eventTitle"] ?? ""),
		inviteeUid: String(document["inviteeUid"] ?? ""),
		inviteeEmail: String(document["inviteeEmail"] ?? ""),
		invitedBy: String(document["invitedBy"] ?? ""),
		invitedByName: String(document["invitedByName"] ?? ""),
		role: document["role"] === "editor" ? "editor" : ("viewer" as EventRole),
		status: "pending",
		createdAt: (document["createdAt"] as EventInvite["createdAt"]) ?? null,
		decidedAt: (document["decidedAt"] as EventInvite["decidedAt"]) ?? null,
	};
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-invitations-inbox": PlanuInvitationsInbox;
	}
}
