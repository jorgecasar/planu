import "@awesome.me/webawesome/dist/components/button/button.js";
import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
	appConsent,
	type ConsentState,
	type ConsentStore,
} from "../../domain/consent.js";
import { webAwesomeStyles } from "../styles/web-awesome.js";

/**
 * Asks, once, whether planu may send error reports and measure usage and
 * speed. Sentry (`infrastructure/firebase/observability.ts`) and analytics
 * (`analytics-adapter.ts`) wait for "granted". Firebase Performance does not
 * yet: HU-439 puts it behind the same gate, and the banner must not be shown
 * before that lands.
 *
 * Accept and refuse weigh the same, nothing is pre-selected, and it is a
 * region, not a dialog. It shows only while undecided; `clear()` brings it back.
 *
 * DRAFT WORDING (HU-438): not a reviewed legal text, and it must say nothing
 * the code does not do.
 */
@customElement("planu-consent-banner")
export class PlanuConsentBanner extends LitElement {
	static override styles = [
		webAwesomeStyles,
		css`
		:host {
			display: block;
		}
		section {
			display: grid;
			gap: var(--wa-space-s);
			padding: var(--wa-space-m) var(--wa-space-l);
			background: var(--wa-color-surface-raised);
			border-block-start: var(--wa-border-width-s) solid
				var(--wa-color-surface-border);
		}
		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: var(--wa-space-s);
		}
	`,
	];

	/** Injected so tests can use their own store; the app-wide one by default. */
	@property({ attribute: false })
	consent: ConsentStore = appConsent();

	@state() private choice: ConsentState = "unset";

	#unsubscribe: (() => void) | undefined;

	override connectedCallback(): void {
		super.connectedCallback();
		this.choice = this.consent.get();
		this.#unsubscribe = this.consent.subscribe((state) => {
			this.choice = state;
		});
	}

	override disconnectedCallback(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		super.disconnectedCallback();
	}

	override render() {
		if (this.choice !== "unset") return nothing;
		return html`
			<section role="region" aria-labelledby="consent-title">
				<h2 id="consent-title" class="wa-heading-s">
					${msg("Your privacy choices")}
				</h2>
				<p>
					${msg("planu can send error reports and measure how the app is used and how fast it runs, using Sentry and Google Firebase, so that problems can be found and fixed. Nothing is sent unless you accept, and you can change your mind at any time.")}
					<a href=${msg("/privacy.html")}>${msg("Read the privacy policy")}</a>
				</p>
				<div class="actions">
					<wa-button
						appearance="outlined"
						@click=${() => this.consent.set("denied")}
						>${msg("Refuse")}</wa-button
					>
					<wa-button
						appearance="outlined"
						@click=${() => this.consent.set("granted")}
						>${msg("Accept")}</wa-button
					>
				</div>
			</section>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-consent-banner": PlanuConsentBanner;
	}
}
