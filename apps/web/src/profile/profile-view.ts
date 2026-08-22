import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import type { Firestore } from "firebase/firestore";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import { signOut } from "../application/sign-out.js";
import {
	firestoreContext,
	sessionContext,
	userContext,
} from "../firebase/context.js";
import { sourceLocale } from "../generated/locales/locale-codes.js";
import { getLocale } from "../i18n/localization.js";

/** Account details and sign out. */
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
	private user: SessionUser | null | undefined;

	@consume({ context: sessionContext, subscribe: true })
	private session: SessionPort | undefined;

	@state() private sending = false;
	@state() private sent = false;
	@state() private checking = false;

	@consume({ context: firestoreContext, subscribe: true })
	private firestore: Firestore | undefined;

	override render() {
		const user = this.user;
		if (!user) return null;

		return html`
			<wa-card>
				<h2 slot="header">${msg("Profile")}</h2>

				${this.#renderVerificationNotice(user)}

				<dl>
					<dt>${msg("Name")}</dt>
					<dd>${user.displayName ?? msg("Not set")}</dd>
					<dt>${msg("Email")}</dt>
					<dd>${user.email ?? msg("Not set")}</dd>
				</dl>

				<div
					slot="footer"
					class="wa-stack wa-gap-s wa-align-items-start"
				>
					<wa-button
						variant="danger"
						appearance="outlined"
						@click=${this.#onSignOut}
					>
						${msg("Sign out")}
					</wa-button>

					<div class="wa-cluster wa-gap-s wa-text-sm">
						<a href="${this.#legalHref("privacy")}" target="_blank" rel="noopener">${msg("Privacy")}</a>
						<span aria-hidden="true">·</span>
						<a href="${this.#legalHref("terms")}" target="_blank" rel="noopener">${msg("Terms")}</a>
					</div>
				</div>
			</wa-card>
		`;
	}

	/**
	 * Until the email is verified this account is absent from the directory and
	 * **nobody can invite it to an event**. Better said here than discovered by
	 * the other person when they cannot find you.
	 */
	/**
	 * Las páginas legales prerrenderizadas viven bajo el prefijo de idioma
	 * —`/es/privacy.html`—, salvo el idioma de origen, en la raíz. El perfil
	 * vive dentro de la SPA y no tiene ese prefijo en su propia URL, así que
	 * hay que calcularlo a partir del idioma que la interfaz sirve ahora
	 * mismo, no del de la landing en la pestaña que lo abrió.
	 */
	#legalHref(page: "privacy" | "terms"): string {
		const locale = getLocale();
		const prefix = locale === sourceLocale ? "" : `/${locale}`;
		return `${prefix}/${page}.html`;
	}

	#renderVerificationNotice(user: SessionUser) {
		if (!user.email || user.emailVerified) return nothing;

		return html`
			<wa-callout variant="warning">
				${msg("Verify your email so others can invite you to their events.")}
				<wa-button
					appearance="plain"
					?disabled=${this.sending || this.sent}
					@click=${this.#onResend}
				>
					${this.sent ? msg("Email sent") : msg("Resend email")}
				</wa-button>
				<wa-button
					appearance="plain"
					?disabled=${this.checking}
					@click=${this.#onCheck}
				>
					${this.checking ? msg("Checking…") : msg("I have verified it")}
				</wa-button>
			</wa-callout>
		`;
	}

	/**
	 * Picks up a verification done elsewhere, in this session.
	 *
	 * Verifying happens in the mail client, and nothing tells this tab about it:
	 * `onAuthStateChanged` does not fire, and the cached `emailVerified` stays
	 * false. Without this the user verifies, comes back, and is still invisible
	 * to anyone trying to invite them.
	 *
	 * `reload()` alone is not enough either. The directory rule reads
	 * `request.auth.token.email_verified`, so the ID token has to be minted
	 * again — hence `getIdToken(true)` — before the entry can be published.
	 */
	async #onCheck(): Promise<void> {
		const { session, firestore } = this;
		if (!session || this.checking) return;

		this.checking = true;
		try {
			const refreshed = await session.refreshEmailVerification();
			if (!refreshed?.emailVerified) return;

			// Manual assignment, not a new arrival via context: `@consume`
			// doesn't intercept it, so the update has to be requested by hand.
			this.user = refreshed;
			const { publishDirectoryEntry } = await import(
				"../sharing/user-directory.js"
			);
			await publishDirectoryEntry(firestore as Firestore, refreshed);
			this.requestUpdate();
		} catch {
			// Nothing the user can act on: the notice stays put and the button can
			// be pressed again.
		} finally {
			this.checking = false;
		}
	}

	async #onResend(): Promise<void> {
		const { session } = this;
		if (!session || this.sending) return;

		this.sending = true;
		try {
			await session.sendVerificationEmail();
			this.sent = true;
		} catch {
			// Firebase throttles repeated attempts. That is not something the
			// user can act on, and the notice stays visible anyway.
		} finally {
			this.sending = false;
		}
	}

	#onSignOut(): void {
		if (this.session) void signOut(this.session);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-profile-view": PlanuProfileView;
	}
}
