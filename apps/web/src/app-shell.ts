import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "./auth/login-view.js";

import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import { Router } from "@lit-labs/router";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionPort, SessionUser } from "./application/ports/session.js";
import { signOut } from "./application/sign-out.js";
import {
	APP_BASE,
	guardRedirect,
	HOME_PATH,
	LOGIN_PATH,
} from "./auth/guard.js";
import { sessionContext, userContext } from "./firebase/context.js";

/** Application root: routing, header and session guard. */
@customElement("planu-app")
export class PlanuApp extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			min-block-size: 100dvh;
		}

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--wa-space-m);
			padding: var(--wa-space-m) var(--wa-space-l);
			border-block-end: solid var(--wa-border-width-s) var(--wa-color-surface-border);
		}

		h1 {
			margin: 0;
			font-size: var(--wa-font-size-l);
		}

		main {
			flex: 1;
		}

		.checking {
			display: grid;
			place-items: center;
			min-block-size: 100dvh;
		}
	`;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@state() private navigating = false;

	@consume({ context: sessionContext, subscribe: true })
	private session: SessionPort | undefined;

	/**
	 * Private routes are loaded on demand.
	 *
	 * The listing pulls in Firestore through the collection controller, so
	 * importing it here statically would put the whole SDK into the startup of
	 * anyone who only reaches the login. `enter()` resolves before rendering.
	 */
	readonly #router = new Router(this, [
		{
			path: HOME_PATH,
			enter: () => this.#enterPrivate(() => import("./events/events-view.js")),
			render: () => html`<planu-events-view></planu-events-view>`,
		},
		{
			path: LOGIN_PATH,
			render: () => html`<planu-login-view></planu-login-view>`,
		},
		{
			path: `${APP_BASE}/profile`,
			enter: () =>
				this.#enterPrivate(() => import("./profile/profile-view.js")),
			render: () => html`<planu-profile-view></planu-profile-view>`,
		},
	]);

	/**
	 * Loads a private route, and only if there is a session.
	 *
	 * Rejecting it while the session is being checked avoids two things:
	 * downloading the data SDK to someone who is only going to see the login,
	 * and a race between this import and the guard's redirect that left the
	 * page blank.
	 */
	async #enterPrivate(load: () => Promise<unknown>): Promise<boolean> {
		if (!this.user) return false;
		await load();
		return true;
	}

	/** Last session seen, to detect when it stops being unknown. */
	#seenUser: SessionUser | null | undefined;

	override willUpdate(): void {
		const target = guardRedirect(this.user, window.location.pathname);
		if (target) {
			void this.#navigate(target);
			return;
		}

		// The route may have been rejected for not yet knowing whether there was
		// a session. Once it's known, it has to be re-evaluated: nobody is
		// navigating, so the router would not do it on its own. This is the case
		// of reloading the page while already signed in, the most common of all.
		if (this.user !== this.#seenUser) {
			this.#seenUser = this.user;
			if (this.user) void this.#resolveRoute(window.location.pathname);
		}
	}

	/**
	 * Navigates and hides the content while the route loads.
	 *
	 * Without this, between the URL change and the import resolving, the
	 * previous view kept showing: after signing up, the login form appeared
	 * under the header until the listing arrived.
	 */
	async #navigate(path: string): Promise<void> {
		if (window.location.pathname === path) return;

		window.history.pushState({}, "", path);
		await this.#resolveRoute(path);
	}

	/**
	 * Single entry point into the router, and always with the indicator set.
	 *
	 * Every route resolution goes through here. When the re-evaluation after
	 * learning the session called `goto()` on its own, `outlet()` kept
	 * rendering the previous view while the import was in flight.
	 */
	async #resolveRoute(path: string): Promise<void> {
		this.navigating = true;
		try {
			await this.#router.goto(path);
		} finally {
			this.navigating = false;
		}
	}

	#onSignOut(): void {
		if (this.session) void signOut(this.session);
	}

	override render() {
		// Three session states, three different screens. Showing the login while
		// it's being checked would cause a flicker on every reload.
		if (this.user === undefined) {
			return html`<div class="checking">
				<wa-spinner aria-label=${msg("Checking your session")}></wa-spinner>
			</div>`;
		}

		return html`
			${this.user ? this.#renderHeader(this.user) : null}
			<main>
				${
					this.navigating
						? html`<div class="checking">
								<wa-spinner aria-label=${msg("Loading")}></wa-spinner>
							</div>`
						: this.#router.outlet()
				}
			</main>
		`;
	}

	#renderHeader(user: SessionUser) {
		const label = user.displayName ?? user.email ?? msg("Account");
		return html`
			<header>
				<h1>planu</h1>
				<wa-dropdown @wa-select=${this.#onMenuSelect}>
					<wa-button slot="trigger" appearance="plain" aria-label=${label}>
						<wa-avatar
							label=${label}
							initials=${(user.email?.[0] ?? "?").toUpperCase()}
							image=${user.photoURL ?? ""}
						></wa-avatar>
					</wa-button>
					<wa-dropdown-item value="profile">${msg("Profile")}</wa-dropdown-item>
					<wa-dropdown-item value="signout">${msg("Sign out")}</wa-dropdown-item>
				</wa-dropdown>
			</header>
		`;
	}

	#onMenuSelect(event: Event): void {
		const item = (event as CustomEvent<{ item: { value: string } }>).detail
			.item;
		// `/app/profile`, no `/profile`: la ruta corta sólo existe como
		// redirect 301 en `firebase.json`, que Hosting aplica pero
		// `@lit-labs/router` no conoce. El clic no hacía nada porque `goto()`
		// no encontraba esa ruta; sólo un refresco —que sí pasa por Hosting—
		// disimulaba el fallo.
		if (item.value === "profile") this.#navigate(`${APP_BASE}/profile`);
		if (item.value === "signout") this.#onSignOut();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-app": PlanuApp;
	}
}
