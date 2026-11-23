import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import { msg } from "@lit/localize";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZodError } from "zod";
import type {
	SessionPort,
	SessionUser,
} from "../../application/ports/session.js";
import type { SharingPort } from "../../application/ports/sharing.js";
import { updateDisplayName } from "../../application/update-display-name.js";
import { authErrorMessage } from "../../domain/auth-errors.js";

/**
 * Edits the display name from the profile. Light DOM, like
 * `planu-change-email-form`: markup and styles stay in the profile's shadow
 * root. On success it fires `display-name-updated` with the refreshed user,
 * because `updateProfile` does not make `onAuthStateChanged` fire.
 */
@customElement("planu-display-name-form")
export class PlanuDisplayNameForm extends LitElement {
	@property({ attribute: false }) user: SessionUser | undefined;
	@property({ attribute: false }) session: SessionPort | undefined;
	@property({ attribute: false }) sharing: SharingPort | undefined;
	@state() private draft: string | undefined;
	@state() private saving = false;
	@state() private status = "";
	@state() private error = "";

	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	override render() {
		return html`
			<form class="wa-stack wa-gap-s" @submit=${this.#onSubmit}>
				<wa-input
					name="displayName"
					autocomplete="name"
					label=${msg("Display name")}
					.value=${this.draft ?? this.user?.displayName ?? ""}
					@input=${this.#onInput}
				></wa-input>
				<p aria-live="polite">${this.status}</p>
				<p aria-live="assertive">${this.error}</p>
				<wa-button type="submit" ?disabled=${this.saving}>
					${this.saving ? msg("Saving…") : msg("Save name")}
				</wa-button>
			</form>
		`;
	}

	#onInput(event: Event): void {
		this.draft = (event.target as HTMLInputElement).value;
	}

	async #onSubmit(event: Event): Promise<void> {
		event.preventDefault();
		const { session, sharing } = this;
		if (!session || !sharing || this.saving) return;

		this.saving = true;
		this.status = "";
		this.error = "";
		try {
			const updated = await updateDisplayName(
				session,
				sharing,
				this.draft ?? this.user?.displayName ?? "",
			);
			this.draft = undefined;
			this.status = msg("Name saved.");
			this.dispatchEvent(
				new CustomEvent("display-name-updated", {
					detail: updated,
					bubbles: true,
					composed: true,
				}),
			);
		} catch (cause) {
			this.error =
				cause instanceof ZodError
					? (cause.issues[0]?.message ?? "")
					: authErrorMessage(cause);
		} finally {
			this.saving = false;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-display-name-form": PlanuDisplayNameForm;
	}
}
