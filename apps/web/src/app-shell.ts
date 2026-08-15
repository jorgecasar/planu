import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "./auth/login-view.js";

import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import { Router } from "@lit-labs/router";
import { type Auth, signOut, type User } from "firebase/auth";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { guardRedirect, HOME_PATH } from "./auth/guard.js";
import { authContext, userContext } from "./firebase/context.js";

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

	@state() private navigating = false;

	@consume({ context: authContext, subscribe: true })
	private auth: Auth | undefined;

	/**
	 * Las rutas privadas se cargan bajo demanda.
	 *
	 * El listado arrastra Firestore por el controlador de colecciones, así que
	 * importarlo aquí de forma estática metía el SDK entero en el arranque de
	 * quien sólo llega al login. `enter()` se resuelve antes de renderizar.
	 */
	readonly #router = new Router(this, [
		{
			path: HOME_PATH,
			enter: () => this.#enterPrivate(() => import("./events/events-view.js")),
			render: () => html`<planu-events-view></planu-events-view>`,
		},
		{
			path: "/login",
			render: () => html`<planu-login-view></planu-login-view>`,
		},
		{
			path: "/profile",
			enter: () =>
				this.#enterPrivate(() => import("./profile/profile-view.js")),
			render: () => html`<planu-profile-view></planu-profile-view>`,
		},
	]);

	/**
	 * Carga una ruta privada, y sólo si hay sesión.
	 *
	 * Rechazarla mientras la sesión se comprueba evita dos cosas: descargar el
	 * SDK de datos a quien sólo va a ver el login, y una carrera entre esta
	 * importación y el redirect de la guarda que dejaba la página en blanco.
	 */
	async #enterPrivate(load: () => Promise<unknown>): Promise<boolean> {
		if (!this.user) return false;
		await load();
		return true;
	}

	/** Última sesión vista, para detectar cuándo deja de ser desconocida. */
	#seenUser: User | null | undefined;

	override willUpdate(): void {
		const target = guardRedirect(this.user, window.location.pathname);
		if (target) {
			void this.#navigate(target);
			return;
		}

		// La ruta se pudo rechazar por no saber aún si había sesión. Al conocerla,
		// hay que reevaluarla: nadie navega, así que el router no lo haría solo.
		if (this.user !== this.#seenUser) {
			this.#seenUser = this.user;
			if (this.user) void this.#router.goto(window.location.pathname);
		}
	}

	/**
	 * Navega y oculta el contenido mientras la ruta se carga.
	 *
	 * Sin esto, entre el cambio de URL y la resolución de la importación se
	 * seguía viendo la vista anterior: tras registrarse aparecía el formulario
	 * de acceso bajo la cabecera hasta que llegaba el listado.
	 */
	async #navigate(path: string): Promise<void> {
		if (window.location.pathname === path) return;

		window.history.pushState({}, "", path);
		this.navigating = true;
		try {
			await this.#router.goto(path);
		} finally {
			this.navigating = false;
		}
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
