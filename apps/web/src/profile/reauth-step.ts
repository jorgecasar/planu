import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import { msg } from "@lit/localize";
import { html, nothing, type ReactiveControllerHost } from "lit";
import type { SessionPort, SessionUser } from "../application/ports/session.js";

/**
 * The "prove it again" step of the delete dialog: its markup, the password
 * and the in-flight flag. A controller rather than an element, because its
 * buttons go to `<wa-dialog>`'s `footer` slot, which only takes direct
 * children of the dialog: a wrapper element would pull them into the body.
 */
export class ReauthStep {
	password = "";
	busy = false;

	readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;

	constructor(host: Pick<ReactiveControllerHost, "requestUpdate">) {
		this.#host = host;
	}

	reset(): void {
		this.password = "";
		this.#host.requestUpdate();
	}

	/**
	 * Reauthenticates, then runs `onConfirmed` — the delete retry — while
	 * still busy, so the dialog cannot be dismissed in between. `onFailed`
	 * runs if anything threw.
	 */
	async confirm(
		session: SessionPort,
		user: SessionUser,
		onConfirmed: () => Promise<void>,
		onFailed: () => void,
	): Promise<void> {
		this.busy = true;
		this.#host.requestUpdate();
		try {
			await session.reauthenticate(
				user.provider === "password" ? this.password : undefined,
			);
			this.password = "";
			await onConfirmed();
		} catch {
			onFailed();
		} finally {
			this.busy = false;
			this.#host.requestUpdate();
		}
	}

	render(
		user: SessionUser | null | undefined,
		error: string,
		onCancel: () => void,
		onConfirm: () => void,
	) {
		const passwordProvider = user?.provider === "password";
		return html`
			<p>
				${msg(
					"This takes a moment: please confirm it's you before we delete your account.",
				)}
			</p>
			${
				passwordProvider
					? html`<wa-input
							type="password"
							label=${msg("Password")}
							.value=${this.password}
							?disabled=${this.busy}
							@input=${this.#onPasswordInput}
						></wa-input>`
					: nothing
			}
			${
				error
					? html`<wa-callout variant="danger" role="alert">
							${error}
						</wa-callout>`
					: nothing
			}
			<wa-button
				slot="footer"
				appearance="outlined"
				?disabled=${this.busy}
				@click=${onCancel}
			>
				${msg("Cancel")}
			</wa-button>
			<wa-button
				slot="footer"
				variant="danger"
				?disabled=${(passwordProvider && !this.password) || this.busy}
				@click=${onConfirm}
			>
				${
					this.busy
						? msg("Confirming…")
						: passwordProvider
							? msg("Confirm and delete")
							: msg("Continue with Google")
				}
			</wa-button>
		`;
	}

	// An arrow, not a method: Lit calls listeners with the host as `this`.
	#onPasswordInput = (event: Event): void => {
		this.password = (event.target as HTMLInputElement).value;
		this.#host.requestUpdate();
	};
}
