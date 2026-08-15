import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import { consume } from "@lit/context";
import { type Auth, signOut, type User } from "firebase/auth";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { authContext, userContext } from "../firebase/context.js";

/** Datos de la cuenta y cierre de sesión. */
@customElement("planu-profile-view")
export class PlanuProfileView extends LitElement {
	static override styles = css`
		:host {
			display: block;
			padding: var(--wa-space-l);
		}

		wa-card {
			inline-size: min(32rem, 100%);
			margin-inline: auto;
		}

		h2 {
			margin: 0;
		}

		dl {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: var(--wa-space-xs) var(--wa-space-m);
			margin: 0;
		}

		dt {
			font-weight: var(--wa-font-weight-semibold);
		}

		dd {
			margin: 0;
		}
	`;

	@consume({ context: userContext, subscribe: true })
	private user: User | null | undefined;

	@consume({ context: authContext, subscribe: true })
	private auth: Auth | undefined;

	override render() {
		const user = this.user;
		if (!user) return null;

		return html`
			<wa-card>
				<h2 slot="header">Profile</h2>

				<dl>
					<dt>Name</dt>
					<dd>${user.displayName ?? "Not set"}</dd>
					<dt>Email</dt>
					<dd>${user.email ?? "Not set"}</dd>
				</dl>

				<wa-button
					slot="footer"
					variant="danger"
					appearance="outlined"
					@click=${this.#onSignOut}
				>
					Sign out
				</wa-button>
			</wa-card>
		`;
	}

	#onSignOut(): void {
		if (this.auth) void signOut(this.auth);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-profile-view": PlanuProfileView;
	}
}
