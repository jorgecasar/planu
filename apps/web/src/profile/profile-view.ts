import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	type DeleteAccountStep,
	deleteAccount,
} from "../application/delete-account.js";
import type { AccountDataPort } from "../application/ports/account-data.js";
import { accountDataContext } from "../application/ports/account-data.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import type { SharingPort } from "../application/ports/sharing.js";
import { sharingContext } from "../application/ports/sharing.js";
import { signOut } from "../application/sign-out.js";
import { SessionError } from "../domain/session-error.js";
import { sessionContext, userContext } from "../firebase/context.js";
import { sourceLocale } from "../generated/locales/locale-codes.js";
import { getLocale } from "../i18n/localization.js";
import "./change-email-form.js";
import { ReauthStep } from "./reauth-step.js";

/** Account details and sign out. */
@customElement("planu-profile-view")
export class PlanuProfileView extends LitElement {
	static override styles = css`
		:host {
			display: block;
			padding: var(--wa-space-l);
		}

		wa-card {
			inline-size: min(32rem, 100%);
			margin-inline: auto;
		}

		h2 {
			margin: 0;
		}

		dl {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: var(--wa-space-xs) var(--wa-space-m);
			margin: 0;
		}

		dt {
			font-weight: var(--wa-font-weight-semibold);
		}

		dd {
			margin: 0;
		}

		planu-change-email-form {
			display: block;
		}

		.change-email {
			margin-block-start: var(--wa-space-s);
		}

		.change-email-status {
			margin: 0;
		}
	`;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@consume({ context: sessionContext, subscribe: true })
	private session: SessionPort | undefined;

	@state() private sending = false;
	@state() private sent = false;
	@state() private checking = false;

	// `SharingPort`, not raw `Firestore`: same reasoning as `AccountDataPort`
	// just below — this already-coupled component's directory-publishing call
	// goes through a port now, built once at the composition root
	// (`firebase-provider.ts`).
	@consume({ context: sharingContext, subscribe: true })
	private sharing: SharingPort | undefined;

	// `AccountDataPort`, not raw `Firestore`/`FirebaseStorage`: T32 touches this
	// already-coupled component, and the project's hexagonal-migration rule is
	// that a task which touches a coupled component leaves it behind a port
	// instead of adding a new raw import. The adapter itself is built once, at
	// the composition root (`firebase-provider.ts`), not here.
	@consume({ context: accountDataContext, subscribe: true })
	private account: AccountDataPort | undefined;

	@state() private confirmingDelete = false;
	@state() private confirmEmail = "";
	@state() private deleteStep: DeleteAccountStep | undefined;
	@state() private deleteError = "";
	/** The one step that needs to ask for credentials again. */
	@state() private needsReauth = false;
	readonly #reauth = new ReauthStep(this);

	override render() {
		const user = this.user;
		if (!user) return null;

		return html`
			<wa-card>
				<h2 slot="header">${msg("Profile")}</h2>

				${this.#renderVerificationNotice(user)}

				<dl>
					<dt>${msg("Name")}</dt>
					<dd>${user.displayName ?? msg("Not set")}</dd>
					<dt>${msg("Email")}</dt>
					<dd>${user.email ?? msg("Not set")}</dd>
				</dl>

				<div
					slot="footer"
					class="wa-stack wa-gap-s wa-align-items-start"
				>
					<div class="wa-cluster wa-gap-s">
						<wa-button
							variant="danger"
							appearance="outlined"
							@click=${this.#onSignOut}
						>
							${msg("Sign out")}
						</wa-button>

						<wa-button
							variant="danger"
							appearance="plain"
							@click=${this.#askDelete}
						>
							${msg("Delete account")}
						</wa-button>
					</div>

					<div class="wa-cluster wa-gap-s wa-text-sm">
						<a href="${this.#legalHref("privacy")}" target="_blank" rel="noopener">${msg("Privacy")}</a>
						<span aria-hidden="true">·</span>
						<a href="${this.#legalHref("terms")}" target="_blank" rel="noopener">${msg("Terms")}</a>
					</div>
				</div>
			</wa-card>

			${this.#renderDeleteDialog(user)}
		`;
	}

	/**
	 * The delete dialog, and when it's needed, the reauthentication one — two
	 * steps because they're two different questions: "are you sure?" first,
	 * "prove it again" only if Firebase demands it. T32 asks for confirmation
	 * by typing the email, not a plain "are you sure?", and warns that shared
	 * events disappear for their guests.
	 */
	#renderDeleteDialog(user: SessionUser) {
		const step = this.deleteStep;
		const deleting = step !== undefined;
		const confirmed =
			!!user.email &&
			this.confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

		return html`
			<wa-dialog
				label=${msg("Delete account")}
				.open=${this.confirmingDelete}
				@wa-hide=${this.#cancelDelete}
			>
				${
					this.needsReauth
						? this.#reauth.render(
								this.user,
								this.deleteError,
								this.#cancelDelete,
								this.#reauthenticateAndRetry,
							)
						: html`
								<p>
									${msg(
										"This permanently deletes your account: every event you own, their cover images, and your entry in the directory. Any event you shared will disappear for the people you invited — they will no longer see it.",
									)}
								</p>
								<p>
									${msg(str`Type your email — ${user.email ?? ""} — to confirm.`)}
								</p>
								<wa-input
									label=${msg("Email")}
									.value=${this.confirmEmail}
									?disabled=${deleting}
									@input=${this.#onConfirmEmailInput}
								></wa-input>
								${
									step
										? html`<wa-progress-bar
												value=${this.#progressValue(step)}
											></wa-progress-bar>
											<p class="wa-text-sm wa-color-text-quiet">
												${this.#progressLabel(step)}
											</p>`
										: nothing
								}
								${
									this.deleteError
										? html`<wa-callout variant="danger" role="alert">
												${this.deleteError}
											</wa-callout>`
										: nothing
								}
								<wa-button
									slot="footer"
									appearance="outlined"
									?disabled=${deleting}
									@click=${this.#cancelDelete}
								>
									${msg("Cancel")}
								</wa-button>
								<wa-button
									slot="footer"
									variant="danger"
									?disabled=${!confirmed || deleting}
									@click=${this.#confirmDelete}
								>
									${deleting ? msg("Deleting…") : msg("Delete account")}
								</wa-button>
							`
				}
			</wa-dialog>
		`;
	}

	/**
	 * Progress as a percentage, 0-100 — `<wa-progress-bar>`'s own scale, not
	 * a 0-1 fraction.
	 */
	#progressValue(step: DeleteAccountStep): number {
		switch (step.phase) {
			case "listing":
				return 10;
			case "deleting-events":
				// 10 to 70: the step that can have many events is the only one
				// with a wide range, so the bar advances along with them.
				return step.total === 0 ? 70 : 10 + 60 * (step.done / step.total);
			case "deleting-directory":
				return 80;
			case "deleting-account":
				return 95;
		}
	}

	#progressLabel(step: DeleteAccountStep): string {
		switch (step.phase) {
			case "listing":
				return msg("Finding what belongs to your account…");
			case "deleting-events":
				return msg(str`Deleting events: ${step.done} of ${step.total}…`);
			case "deleting-directory":
				return msg("Removing your files and directory entry…");
			case "deleting-account":
				return msg("Deleting your account…");
		}
	}

	/**
	 * Until the email is verified this account is absent from the directory and
	 * **nobody can invite it to an event**. Better said here than discovered by
	 * the other person when they cannot find you.
	 */
	/**
	 * Las páginas legales prerrenderizadas viven bajo el prefijo de idioma
	 * —`/es/privacy.html`—, salvo el idioma de origen, en la raíz. El perfil
	 * vive dentro de la SPA y no tiene ese prefijo en su propia URL, así que
	 * hay que calcularlo a partir del idioma que la interfaz sirve ahora
	 * mismo, no del de la landing en la pestaña que lo abrió.
	 */
	#legalHref(page: "privacy" | "terms"): string {
		const locale = getLocale();
		const prefix = locale === sourceLocale ? "" : `/${locale}`;
		return `${prefix}/${page}.html`;
	}

	#renderVerificationNotice(user: SessionUser) {
		if (!user.email || user.emailVerified) return nothing;

		return html`
			<wa-callout variant="warning">
				${msg("Verify your email so others can invite you to their events.")}
				<wa-button
					appearance="plain"
					?disabled=${this.sending || this.sent}
					@click=${this.#onResend}
				>
					${this.sent ? msg("Email sent") : msg("Resend email")}
				</wa-button>
				<wa-button
					appearance="plain"
					?disabled=${this.checking}
					@click=${this.#onCheck}
				>
					${this.checking ? msg("Checking…") : msg("I have verified it")}
				</wa-button>
				${
					user.provider === "password"
						? html`<planu-change-email-form
								.user=${user}
								.session=${this.session}
							></planu-change-email-form>`
						: nothing
				}
			</wa-callout>
		`;
	}

	/**
	 * Picks up a verification done elsewhere, in this session.
	 *
	 * Verifying happens in the mail client, and nothing tells this tab about it:
	 * `onAuthStateChanged` does not fire, and the cached `emailVerified` stays
	 * false. Without this the user verifies, comes back, and is still invisible
	 * to anyone trying to invite them.
	 *
	 * `reload()` alone is not enough either. The directory rule reads
	 * `request.auth.token.email_verified`, so the ID token has to be minted
	 * again — hence `getIdToken(true)` — before the entry can be published.
	 */
	async #onCheck(): Promise<void> {
		const { session, sharing } = this;
		if (!session || !sharing || this.checking) return;

		this.checking = true;
		try {
			const refreshed = await session.refreshEmailVerification();
			if (!refreshed?.emailVerified) return;

			await sharing.publishDirectoryEntry(refreshed);
			// Only after publishing: the notice hides once `user` is verified and
			// is the only way to retry. `@consume` doesn't see this assignment.
			this.user = refreshed;
			this.requestUpdate();
		} catch {
			// Nothing the user can act on: the notice stays put and the button can
			// be pressed again.
		} finally {
			this.checking = false;
		}
	}

	async #onResend(): Promise<void> {
		const { session } = this;
		if (!session || this.sending) return;

		this.sending = true;
		try {
			await session.sendVerificationEmail();
			this.sent = true;
		} catch {
			// Firebase throttles repeated attempts. That is not something the
			// user can act on, and the notice stays visible anyway.
		} finally {
			this.sending = false;
		}
	}

	#onSignOut(): void {
		if (this.session) void signOut(this.session);
	}

	#askDelete(): void {
		this.confirmingDelete = true;
		this.confirmEmail = "";
		this.deleteError = "";
	}

	#cancelDelete(event?: Event): void {
		// Doesn't cancel mid-deletion or mid-reauthentication: dismissing the
		// dialog while either is in flight would let it keep running in the
		// background — including a successful reauthentication sliding
		// straight into `#runDelete()` — with nobody watching. The dialog's
		// own Cancel button is disabled for both cases already; this guards
		// the other way in, `@wa-hide` from Escape or the header close button.
		// Returning isn't enough there: Web Awesome closes the dialog unless
		// the `wa-hide` is cancelled.
		if (this.deleteStep || this.#reauth.busy) {
			event?.preventDefault();
			return;
		}
		this.confirmingDelete = false;
		this.needsReauth = false;
		this.#reauth.reset();
	}

	#onConfirmEmailInput(event: Event): void {
		this.confirmEmail = (event.target as HTMLInputElement).value;
	}

	async #confirmDelete(): Promise<void> {
		// Explicit reentrancy guard, same reason as `#onCheck`/`#onResend`:
		// without it, two quick clicks would fire two deletions at once.
		// Neither would corrupt anything — the whole use case is idempotent —
		// but it's a redundant network round trip the rest of this file
		// already avoids on purpose.
		if (this.deleteStep) return;
		const { session, account, user } = this;
		if (!session || !account || !user) return;

		this.deleteError = "";
		await this.#runDelete(session, account, user);
	}

	/**
	 * The one step that can demand reauthentication: `deleteUser()` inside
	 * `deleteAccount()`. Everything before it — events, images, directory —
	 * is already deleted by the time this happens, so the retry repeats
	 * nothing: it lists (empty) and lands directly on the last step.
	 */
	async #runDelete(
		session: SessionPort,
		account: AccountDataPort,
		user: SessionUser,
	): Promise<void> {
		try {
			await deleteAccount(session, account, user, (step) => {
				this.deleteStep = step;
			});
			// The account no longer exists: `onAuthStateChanged` in the
			// provider picks it up and the guard redirects to login on its own.
			// Nothing else to do here.
		} catch (cause) {
			this.deleteStep = undefined;
			if (
				cause instanceof SessionError &&
				cause.code === "requires-recent-login"
			) {
				this.needsReauth = true;
				return;
			}
			this.deleteError = msg(
				"Something went wrong deleting your account. You can try again.",
			);
		}
	}

	async #reauthenticateAndRetry(): Promise<void> {
		// Same reason as in `#confirmDelete()`: a second click while the first
		// is still in flight must not fire a second reauthentication.
		if (this.#reauth.busy || this.deleteStep) return;
		const { session, account, user } = this;
		if (!session || !account || !user) return;

		this.deleteError = "";
		await this.#reauth.confirm(
			session,
			user,
			async () => {
				this.needsReauth = false;
				await this.#runDelete(session, account, user);
			},
			() => {
				this.deleteError = msg("That did not work. Please try again.");
			},
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-profile-view": PlanuProfileView;
	}
}
