import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import { msg } from "@lit/localize";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { changeEmail } from "../application/change-email.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import { authErrorMessage } from "../domain/auth-errors.js";

/**
 * The form behind "Wrong email? Change it". Fires `change-email-sent` with
 * the new address in `detail` once the link is out, and `change-email-cancel`.
 *
 * Light DOM: markup, focus and styles stay in `planu-profile-view`'s shadow
 * root.
 */
@customElement("planu-change-email-form")
export class PlanuChangeEmailForm extends LitElement {
	@property({ attribute: false }) user: SessionUser | undefined;
	@property({ attribute: false }) session: SessionPort | undefined;

	@state() private newEmail = "";
	@state() private sendingChangeEmail = false;
	@state() private changeEmailError = "";

	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	protected override async firstUpdated(): Promise<void> {
		// The button that opened the form just disappeared; without this, focus
		// falls back to the page and a keyboard user has to find the field.
		await this.updateComplete;
		this.querySelector<HTMLElement>('wa-input[type="email"]')?.focus();
	}

	override render() {
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
						@click=${this.#onCancel}
					>
						${msg("Cancel")}
					</wa-button>
				</div>
			</form>
		`;
	}

	#onCancel(): void {
		this.dispatchEvent(new Event("change-email-cancel"));
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
			const sentTo = await changeEmail(session, user, this.newEmail);
			this.dispatchEvent(
				new CustomEvent("change-email-sent", { detail: sentTo }),
			);
		} catch (cause) {
			this.changeEmailError = authErrorMessage(cause);
		} finally {
			this.sendingChangeEmail = false;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-change-email-form": PlanuChangeEmailForm;
	}
}
