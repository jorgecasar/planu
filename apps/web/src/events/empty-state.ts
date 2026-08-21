import "@awesome.me/webawesome/dist/components/button/button.js";

import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * What's shown when the user has no events yet (T33).
 *
 * Lives apart from `events-view` for the same reason as `event-groups`:
 * that one consumes `Firestore` and `User` via context, so it can't be
 * mounted in a test without emulators. Unlike the "your search finds
 * nothing" message — a plain sentence with no behavior — this one has
 * three actions to test, and so earns its own file and its own test.
 *
 * No modal tour: T33 explicitly rules it out. And the sample event is just
 * a discreet invitation — never saved on its own —: whoever asks for it sees
 * the same editor as a manual entry, with the fields already filled in to
 * review.
 *
 * Like `event-card` with `planu-edit-event`: this component doesn't decide
 * what to do with each action, it only emits it. It's `events-view` that
 * decides whether to open the editor, the AI generator, or fill in a sample
 * draft.
 */
@customElement("planu-empty-state")
export class PlanuEmptyState extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: var(--wa-space-m);
			margin-block-start: var(--wa-space-m);
		}

		.sample {
			margin-block-start: var(--wa-space-l);
		}
	`;

	/**
	 * Whether it's worth offering AI generation. `events-view` decides it —
	 * it's the one that consults `checkAvailability()` — same as it already
	 * does with the "New event" menu: a button that would always fail is
	 * worse than none.
	 */
	@property({ type: Boolean }) aiAvailable = false;

	override render() {
		return html`
			<p>${msg("You have no events yet.")}</p>
			<p>
				${
					this.aiAvailable
						? msg(
								"Add it by hand, or let AI fill in the details from a photo of a poster or some pasted text.",
							)
						: msg("Add the details yourself to get started.")
				}
			</p>

			<div class="actions">
				<wa-button variant="brand" @click=${this.#onManual}>
					${msg("Create your first event")}
				</wa-button>
				${
					this.aiAvailable
						? html`<wa-button appearance="outlined" @click=${this.#onGenerate}>
								${msg("Generate with AI")}
							</wa-button>`
						: nothing
				}
			</div>

			<p class="sample">
				<wa-button appearance="plain" @click=${this.#onSample}>
					${msg("Try a sample event instead")}
				</wa-button>
			</p>
		`;
	}

	#onManual(): void {
		this.dispatchEvent(
			new CustomEvent("planu-create-event", { bubbles: true, composed: true }),
		);
	}

	#onGenerate(): void {
		this.dispatchEvent(
			new CustomEvent("planu-open-generator", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	#onSample(): void {
		this.dispatchEvent(
			new CustomEvent("planu-try-sample", { bubbles: true, composed: true }),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-empty-state": PlanuEmptyState;
	}
}
