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
import { css, html, LitElement, nothing } from "lit";
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
import {
	type AuthField,
	authErrorField,
	authErrorMessage,
} from "../domain/auth-errors.js";
import { typographyStyles } from "../styles/typography.js";
import { type LoginNotice, takeLoginNotice } from "./login-notice.js";

/** Long enough for screen readers to register the empty live region. */
const NOTICE_DELAY_MS = 250;

type FormName = "signin" | "signup";

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

		wa-input.invalid::part(input-wrapper) {
			border-color: var(--wa-color-danger-border-loud);
		}

		.field-error {
			color: var(--wa-color-danger-on-quiet);
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
	@state() private notice: LoginNotice | undefined;

	#noticeTimer: ReturnType<typeof setTimeout> | undefined;

	override connectedCallback(): void {
		super.connectedCallback();
		// A live region announces what changes inside it, not what it held
		// when it appeared. Filled in the same task it's inserted, VoiceOver
		// may say nothing, so the notice waits for the region to settle.
		const notice = takeLoginNotice(window.history);
		if (notice) {
			this.#noticeTimer = setTimeout(() => {
				this.notice = notice;
			}, NOTICE_DELAY_MS);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		clearTimeout(this.#noticeTimer);
	}

	/** Field the error belongs to; none leaves it a notice above the form. */
	@state() private errorAt: { form: FormName; field: AuthField } | null = null;

	override render() {
		return html`
			<wa-card>
				<h1 slot="header">planu</h1>

				<div role="status">${this.#renderNotice()}</div>

				${
					this.error && !this.errorAt
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: null
				}

				<wa-tab-group>
					<wa-tab panel="signin">${msg("Sign in")}</wa-tab>
					<wa-tab panel="signup">${msg("Create account")}</wa-tab>

					<wa-tab-panel name="signin" active>
						<form @submit=${this.#onSignIn} @input=${this.#onInput}>
							<wa-input
								name="email"
								type="email"
								label=${msg("Email")}
								autocomplete="email"
								required
								class=${this.#invalid("signin", "email")}
							>${this.#errorHint("signin", "email")}</wa-input>
							<wa-input
								name="password"
								type="password"
								label=${msg("Password")}
								autocomplete="current-password"
								required
								minlength="6"
								class=${this.#invalid("signin", "password")}
							>${this.#errorHint("signin", "password")}</wa-input>
							<wa-button type="submit" variant="brand" ?disabled=${this.busy}>
								${this.busy ? msg("Signing in…") : msg("Sign in")}
							</wa-button>
						</form>
					</wa-tab-panel>

					<wa-tab-panel name="signup">
						<form @submit=${this.#onSignUp} @input=${this.#onInput}>
							<wa-input
								name="email"
								type="email"
								label=${msg("Email")}
								autocomplete="email"
								required
								class=${this.#invalid("signup", "email")}
							>${this.#errorHint("signup", "email")}</wa-input>
							<wa-input
								name="password"
								type="password"
								label=${msg("Password")}
								hint=${msg("At least 6 characters.")}
								autocomplete="new-password"
								required
								minlength="6"
								class=${this.#invalid("signup", "password")}
							>${this.#errorHint("signup", "password")}</wa-input>
							<wa-input
								name="confirmPassword"
								type="password"
								label=${msg("Confirm password")}
								autocomplete="new-password"
								required
								minlength="6"
								class=${this.#invalid("signup", "confirmPassword")}
							>${this.#errorHint("signup", "confirmPassword")}</wa-input>
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

	#fieldError(form: FormName, field: AuthField): string {
		const at = this.errorAt;
		return at?.form === form && at.field === field ? this.error : "";
	}

	#invalid(form: FormName, field: AuthField): string {
		return this.#fieldError(form, field) ? "invalid" : "";
	}

	/** The message in the hint slot: under the field, as its description. */
	#errorHint(form: FormName, field: AuthField) {
		const message = this.#fieldError(form, field);
		if (!message) return nothing;
		return html`<span slot="hint" class="field-error" role="alert">${message}</span>`;
	}

	/** Typing again is the fix: the message under the field has done its job. */
	#onInput(): void {
		if (!this.errorAt) return;
		this.error = "";
		this.errorAt = null;
	}

	#renderNotice() {
		switch (this.notice) {
			case "account-deleted":
				return html`<wa-callout variant="success">
					${msg("Your account has been deleted.")}
				</wa-callout>`;
			case "deletion-interrupted":
				return html`<wa-callout variant="warning">
					${msg(
						"Your session ended before your account was fully deleted. Sign in again and delete it once more to finish.",
					)}
				</wa-callout>`;
			default:
				return nothing;
		}
	}

	/** Collects the form and runs the action, unifying errors and state. */
	async #submit(
		event: SubmitEvent,
		name: FormName,
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
		this.errorAt = null;
		this.busy = true;
		try {
			await action(values, session);
		} catch (cause) {
			this.error = authErrorMessage(cause);
			const field = authErrorField(cause);
			this.errorAt = field ? { form: name, field } : null;
		} finally {
			this.busy = false;
		}

		// The field that has to change takes the focus, so retyping is one
		// step away.
		if (!this.errorAt) return;
		await this.updateComplete;
		form.querySelector<HTMLElement>(`[name="${this.errorAt.field}"]`)?.focus();
	}

	#onSignIn(event: SubmitEvent): void {
		void this.#submit(event, "signin", (values, session) =>
			signIn(session, values),
		);
	}

	#onSignUp(event: SubmitEvent): void {
		void this.#submit(event, "signup", (values, session) =>
			signUp(session, this.analytics, values),
		);
	}

	#onGoogle(): void {
		const { session } = this;
		if (!session) return;
		this.error = "";
		this.errorAt = null;
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
