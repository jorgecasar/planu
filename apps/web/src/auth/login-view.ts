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
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { sessionContext } from "../application/context.js";
import type { AnalyticsPort } from "../application/ports/analytics.js";
import {
	analyticsContext,
	noopAnalytics,
} from "../application/ports/analytics.js";
import type { SessionPort } from "../application/ports/session.js";
import { signIn } from "../application/sign-in.js";
import { signInWithGoogle } from "../application/sign-in-with-google.js";
import { signUp } from "../application/sign-up.js";
import { authErrorMessage } from "../domain/auth-errors.js";
import { typographyStyles } from "../styles/typography.js";

/**
 * Sign in and sign up. The redirect on entry does not happen here: the shell
 * observes the session change and redirects.
 */
@customElement("planu-login-view")
export class PlanuLoginView extends LitElement {
	static override styles = [
		typographyStyles,
		css`
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
	`,
	];

	@consume({ context: sessionContext, subscribe: true })
	private session: SessionPort | undefined;

	@consume({ context: analyticsContext, subscribe: true })
	private analytics: AnalyticsPort = noopAnalytics;

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

	/** Collects the form and runs the action, unifying errors and state. */
	async #submit(
		event: SubmitEvent,
		action: (
			values: Record<string, string>,
			session: SessionPort,
		) => Promise<unknown>,
	): Promise<void> {
		event.preventDefault();
		// Captured here so the actions receive it already narrowed.
		const session = this.session;
		if (!session) return;

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
			await action(values, session);
		} catch (cause) {
			this.error = authErrorMessage(cause);
		} finally {
			this.busy = false;
		}
	}

	#onSignIn(event: SubmitEvent): void {
		void this.#submit(event, (values, session) => signIn(session, values));
	}

	#onSignUp(event: SubmitEvent): void {
		void this.#submit(event, (values, session) =>
			signUp(session, this.analytics, values),
		);
	}

	#onGoogle(): void {
		const { session } = this;
		if (!session) return;
		this.error = "";
		this.busy = true;

		signInWithGoogle(session)
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
