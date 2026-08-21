import "@awesome.me/webawesome/dist/components/button/button.js";

import { msg } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Lo que se enseña cuando el usuario no tiene ningún evento todavía (T33).
 *
 * Vive aparte de `events-view` por lo mismo que `event-groups`: aquélla
 * consume `Firestore` y `User` por contexto, así que no se puede montar en
 * un test sin emuladores. A diferencia del mensaje de "tu búsqueda no
 * encuentra nada" -una frase suelta sin comportamiento-, esto tiene tres
 * acciones que probar, y por tanto merece su propio fichero y su propio test.
 *
 * Nada de tour modal: T33 lo descarta explícitamente. Y el evento de ejemplo
 * es sólo una invitación discreta -nunca se guarda solo-: quien lo pide ve el
 * mismo editor que un alta manual, con los campos ya rellenos para revisar.
 *
 * Como `event-card` con `planu-edit-event`: este componente no decide qué
 * hacer con cada acción, sólo la emite. Es `events-view` quien decide abrir
 * el editor, el generador de IA, o rellenar un borrador de ejemplo.
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
	 * Si merece la pena ofrecer la generación con IA. La decide `events-view`
	 * -es quien consulta `checkAvailability()`-, igual que ya hace con el menú
	 * de "New event": un botón que siempre fallaría es peor que ninguno.
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
