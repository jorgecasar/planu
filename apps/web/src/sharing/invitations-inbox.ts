import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionUser } from "../application/ports/session.js";
import {
	type ReceivedInvite,
	type SharingPort,
	sharingContext,
} from "../application/ports/sharing.js";
import { userContext } from "../firebase/context.js";

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

	@consume({ context: sharingContext, subscribe: true })
	private sharing: SharingPort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@state() private busyWith = "";
	@state() private error = "";
	@state() private invites: ReceivedInvite[] = [];

	/** Resubscribing on every update would loop. */
	#queryKey: string | undefined;
	#unsubscribe: (() => void) | undefined;

	override connectedCallback(): void {
		super.connectedCallback();
		// After a reconnect, `willUpdate` has to listen again.
		this.#queryKey = undefined;
		this.requestUpdate();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		this.invites = [];
	}

	override willUpdate(): void {
		const { sharing, user } = this;
		const key = sharing && user ? user.uid : "";
		if (key === this.#queryKey) return;
		this.#queryKey = key;

		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		if (!sharing || !user) {
			this.invites = [];
			return;
		}
		this.#unsubscribe = sharing.watchReceivedInvites(user.uid, (invites) => {
			this.invites = invites;
		});
	}

	override render() {
		const { invites } = this;
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

	#renderInvite(invite: ReceivedInvite) {
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

	async #accept(invite: ReceivedInvite): Promise<void> {
		await this.#run(invite, (sharing) => sharing.acceptInvite(invite));
	}

	async #decline(invite: ReceivedInvite): Promise<void> {
		await this.#run(invite, (sharing) => sharing.declineInvite(invite.id));
	}

	async #run(
		invite: ReceivedInvite,
		action: (sharing: SharingPort) => Promise<void>,
	): Promise<void> {
		const { sharing } = this;
		if (!sharing || this.busyWith) return;

		this.error = "";
		this.busyWith = invite.id;
		try {
			await action(sharing);
		} catch {
			this.error = msg("That did not work. Please try again.");
		} finally {
			this.busyWith = "";
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-invitations-inbox": PlanuInvitationsInbox;
	}
}
