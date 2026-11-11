import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import { msg, str } from "@lit/localize";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { changeEmail } from "../application/change-email.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import { authErrorMessage } from "../domain/auth-errors.js";

/**
 * A mistyped address at sign-up can never be verified — the link goes to
 * an inbox nobody reads — and the verification notice would only keep
 * resending it. This lets the person fix the address instead. Only for
 * password accounts: Google arrives verified and its address belongs to
 * Google, not to us.
 *
 * Collapsed behind a button so the common case — the address is right,
 * the mail just hasn't been opened yet — keeps the notice short.
 *
 * Light DOM: markup, focus and styles stay in `planu-profile-view`'s shadow
 * root.
 */
@customElement("planu-change-email-form")
export class PlanuChangeEmailForm extends LitElement {
	@property({ attribute: false }) user: SessionUser | undefined;
	@property({ attribute: false }) session: SessionPort | undefined;

	@state() private changingEmail = false;
	@state() private newEmail = "";
	@state() private sendingChangeEmail = false;
	@state() private changeEmailSentTo = "";
	@state() private changeEmailError = "";

	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	override render() {
		const sentTo = this.changeEmailSentTo;
		// The status region is always in the DOM, empty until there's
		// something to say: a live region inserted together with its text is
		// often not announced at all. Not focusable: focusing a live region
		// gets its text read twice, once as focus and once as the update.
		return html`
			<div class="change-email wa-stack wa-gap-s">
				<p class="change-email-status" role="status">
					${
						sentTo
							? msg(
									str`We sent a link to ${sentTo}. Open it to switch your account to that address, then sign in again with it.`,
								)
							: nothing
					}
				</p>
				${
					sentTo
						? html`<wa-button
								class="change-email-retry"
								appearance="plain"
								@click=${this.#retryChangeEmail}
							>
								${msg("Use a different email")}
							</wa-button>`
						: this.changingEmail
							? this.#renderForm()
							: html`<wa-button
									class="change-email-open"
									appearance="plain"
									@click=${this.#openChangeEmail}
								>
									${msg("Wrong email? Change it")}
								</wa-button>`
				}
			</div>
		`;
	}

	#renderForm() {
		return html`
			<form class="wa-stack wa-gap-s" @submit=${this.#onChangeEmail}>
				<wa-input
					type="email"
					autocomplete="email"
					label=${msg("New email")}
					required
					.value=${this.newEmail}
					?disabled=${this.sendingChangeEmail}
					@input=${this.#onNewEmailInput}
				></wa-input>
				${
					this.changeEmailError
						? html`<wa-callout variant="danger" role="alert">
								${this.changeEmailError}
							</wa-callout>`
						: nothing
				}
				<div class="wa-cluster wa-gap-s">
					<wa-button
						type="submit"
						variant="brand"
						?disabled=${!this.newEmail.trim() || this.sendingChangeEmail}
					>
						${this.sendingChangeEmail ? msg("Sending…") : msg("Send link")}
					</wa-button>
					<wa-button
						appearance="plain"
						?disabled=${this.sendingChangeEmail}
						@click=${this.#closeChangeEmail}
					>
						${msg("Cancel")}
					</wa-button>
				</div>
			</form>
		`;
	}

	async #openChangeEmail(): Promise<void> {
		this.changingEmail = true;
		this.newEmail = "";
		this.changeEmailError = "";
		// The button that was focused just disappeared; without this, focus
		// falls back to the page and a keyboard user has to find the field.
		await this.updateComplete;
		this.#focus('wa-input[type="email"]');
	}

	/** A second typo deserves the same way out as the first. */
	async #retryChangeEmail(): Promise<void> {
		this.changeEmailSentTo = "";
		await this.#openChangeEmail();
	}

	async #closeChangeEmail(): Promise<void> {
		this.changingEmail = false;
		this.changeEmailError = "";
		// Same reason as on open: the focused Cancel button just vanished, and
		// focus would otherwise drop to <body>.
		await this.updateComplete;
		this.#focus(".change-email-open");
	}

	#focus(selector: string): void {
		this.querySelector<HTMLElement>(selector)?.focus();
	}

	#onNewEmailInput(event: Event): void {
		this.newEmail = (event.target as HTMLInputElement).value;
	}

	async #onChangeEmail(event: Event): Promise<void> {
		event.preventDefault();
		const { session, user } = this;
		if (!session || !user || this.sendingChangeEmail) return;

		this.changeEmailError = "";
		this.sendingChangeEmail = true;
		try {
			this.changeEmailSentTo = await changeEmail(session, user, this.newEmail);
			this.changingEmail = false;
		} catch (cause) {
			this.changeEmailError = authErrorMessage(cause);
			return;
		} finally {
			this.sendingChangeEmail = false;
		}
		// The form that held focus is gone. The status region announces the
		// confirmation by itself; focus goes to the control that replaced the
		// form, not to the region, so the text is not read twice.
		await this.updateComplete;
		this.#focus(".change-email-retry");
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-change-email-form": PlanuChangeEmailForm;
	}
}
