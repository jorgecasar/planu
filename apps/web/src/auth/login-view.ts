import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/tab-group/tab-group.js";
import "@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js";
import "@awesome.me/webawesome/dist/components/tab/tab.js";
import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import type { Auth } from "firebase/auth";
import {
	createUserWithEmailAndPassword,
	GoogleAuthProvider,
	signInWithEmailAndPassword,
	signInWithPopup,
} from "firebase/auth";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { authContext } from "../firebase/context.js";
import { authErrorMessage } from "./auth-errors.js";
import { credentialsSchema, signUpSchema } from "./schemas.js";

/**
 * Acceso y registro. La redirección al entrar no se hace aquí: el cambio de
 * sesión lo observa el shell, que reencamina.
 */
@customElement("planu-login-view")
export class PlanuLoginView extends LitElement {
	static override styles = css`
		:host {
			display: grid;
			place-items: center;
			min-block-size: 100dvh;
			padding: var(--wa-space-l);
		}

		wa-card {
			inline-size: min(28rem, 100%);
		}

		h1 {
			margin: 0;
		}

		form {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-m);
		}

		.providers {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-m);
			margin-block-start: var(--wa-space-m);
		}
	`;

	@consume({ context: authContext, subscribe: true })
	private auth: Auth | undefined;

	@state() private error = "";
	@state() private busy = false;

	override render() {
		return html`
			<wa-card>
				<h1 slot="header">planu</h1>

				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: null
				}

				<wa-tab-group>
					<wa-tab panel="signin">${msg("Sign in")}</wa-tab>
					<wa-tab panel="signup">${msg("Create account")}</wa-tab>

					<wa-tab-panel name="signin" active>
						<form @submit=${this.#onSignIn}>
							<wa-input
								name="email"
								type="email"
								label=${msg("Email")}
								autocomplete="email"
								required
							></wa-input>
							<wa-input
								name="password"
								type="password"
								label=${msg("Password")}
								autocomplete="current-password"
								required
								minlength="6"
							></wa-input>
							<wa-button type="submit" variant="brand" ?disabled=${this.busy}>
								${this.busy ? msg("Signing in…") : msg("Sign in")}
							</wa-button>
						</form>
					</wa-tab-panel>

					<wa-tab-panel name="signup">
						<form @submit=${this.#onSignUp}>
							<wa-input
								name="email"
								type="email"
								label=${msg("Email")}
								autocomplete="email"
								required
							></wa-input>
							<wa-input
								name="password"
								type="password"
								label=${msg("Password")}
								hint=${msg("At least 6 characters.")}
								autocomplete="new-password"
								required
								minlength="6"
							></wa-input>
							<wa-input
								name="confirmPassword"
								type="password"
								label=${msg("Confirm password")}
								autocomplete="new-password"
								required
								minlength="6"
							></wa-input>
							<wa-button type="submit" variant="brand" ?disabled=${this.busy}>
								${this.busy ? msg("Creating account…") : msg("Create account")}
							</wa-button>
						</form>
					</wa-tab-panel>
				</wa-tab-group>

				<div class="providers">
					<wa-divider></wa-divider>
					<wa-button
						appearance="outlined"
						?disabled=${this.busy}
						@click=${this.#onGoogle}
					>
						${msg("Continue with Google")}
					</wa-button>
				</div>
			</wa-card>
		`;
	}

	/** Recoge el formulario y ejecuta la acción, unificando errores y estado. */
	async #submit(
		event: SubmitEvent,
		action: (values: Record<string, string>, auth: Auth) => Promise<unknown>,
	): Promise<void> {
		event.preventDefault();
		// Se captura aquí para que las acciones lo reciban ya estrechado.
		const auth = this.auth;
		if (!auth) return;

		const form = event.target as HTMLFormElement;
		const values = Object.fromEntries(
			[...new FormData(form).entries()].map(([key, value]) => [
				key,
				String(value),
			]),
		);

		this.error = "";
		this.busy = true;
		try {
			await action(values, auth);
		} catch (cause) {
			this.error = authErrorMessage(cause);
		} finally {
			this.busy = false;
		}
	}

	#onSignIn(event: SubmitEvent): void {
		void this.#submit(event, async (values, auth) => {
			const parsed = credentialsSchema().safeParse(values);
			if (!parsed.success) throw parsed.error;
			return signInWithEmailAndPassword(
				auth,
				parsed.data.email,
				parsed.data.password,
			);
		});
	}

	#onSignUp(event: SubmitEvent): void {
		void this.#submit(event, async (values, auth) => {
			const parsed = signUpSchema().safeParse(values);
			if (!parsed.success) throw parsed.error;
			return createUserWithEmailAndPassword(
				auth,
				parsed.data.email,
				parsed.data.password,
			);
		});
	}

	#onGoogle(): void {
		if (!this.auth) return;
		this.error = "";
		this.busy = true;
		signInWithPopup(this.auth, new GoogleAuthProvider())
			.catch((cause: unknown) => {
				this.error = authErrorMessage(cause);
			})
			.finally(() => {
				this.busy = false;
			});
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-login-view": PlanuLoginView;
	}
}
