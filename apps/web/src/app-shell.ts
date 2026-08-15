import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "./auth/login-view.js";
import "./events/events-view.js";
import "./profile/profile-view.js";

import { consume } from "@lit/context";
import { Router } from "@lit-labs/router";
import { type Auth, signOut, type User } from "firebase/auth";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { guardRedirect, HOME_PATH } from "./auth/guard.js";
import { authContext, userContext } from "./firebase/context.js";
import { msg } from "@lit/localize";

/** Raíz de la aplicación: enrutado, cabecera y guarda de sesión. */
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
	private user: User | null | undefined;

	@consume({ context: authContext, subscribe: true })
	private auth: Auth | undefined;

	readonly #router = new Router(this, [
		{
			path: HOME_PATH,
			render: () => html`<planu-events-view></planu-events-view>`,
		},
		{
			path: "/login",
			render: () => html`<planu-login-view></planu-login-view>`,
		},
		{
			path: "/profile",
			render: () => html`<planu-profile-view></planu-profile-view>`,
		},
	]);

	override willUpdate(): void {
		const target = guardRedirect(this.user, window.location.pathname);
		if (target) this.#navigate(target);
	}

	#navigate(path: string): void {
		if (window.location.pathname === path) return;
		window.history.pushState({}, "", path);
		void this.#router.goto(path);
	}

	#onSignOut(): void {
		if (this.auth) void signOut(this.auth);
	}

	override render() {
		// Tres estados de sesión, tres pantallas distintas. Mostrar el login
		// mientras se comprueba provocaría un parpadeo en cada recarga.
		if (this.user === undefined) {
			return html`<div class="checking">
				<wa-spinner aria-label=${msg("Checking your session")}></wa-spinner>
			</div>`;
		}

		return html`
			${this.user ? this.#renderHeader(this.user) : null}
			<main>${this.#router.outlet()}</main>
		`;
	}

	#renderHeader(user: User) {
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
		if (item.value === "profile") this.#navigate("/profile");
		if (item.value === "signout") this.#onSignOut();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-app": PlanuApp;
	}
}
