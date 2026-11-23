import "@awesome.me/webawesome/dist/components/button/button.js";
import { consume } from "@lit/context";
import { msg } from "@lit/localize";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { userContext } from "../../application/context.js";
import { exportAccount } from "../../application/export-account.js";
import {
	type AccountExportPort,
	accountExportContext,
} from "../../application/ports/account-export.js";
import type { SessionUser } from "../../application/ports/session.js";
import { webAwesomeStyles } from "../styles/web-awesome.js";

/** "Download my data" (GDPR art. 15 and 20): a JSON file built in the browser. */
@customElement("planu-export-data-button")
export class PlanuExportDataButton extends LitElement {
	static override styles = [webAwesomeStyles];

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@consume({ context: accountExportContext, subscribe: true })
	private port: AccountExportPort | undefined;

	@state() private busy = false;
	@state() private failed = false;

	override render() {
		return html`
			<wa-button
				appearance="outlined"
				variant="neutral"
				?loading=${this.busy}
				?disabled=${!this.port || !this.user}
				@click=${this.#download}
			>
				${msg("Download my data")}
			</wa-button>
			${
				this.failed
					? html`<p role="alert" class="wa-color-text-quiet wa-font-size-s">
						${msg("We could not prepare your data. Try again.")}
					</p>`
					: nothing
			}
		`;
	}

	async #download(): Promise<void> {
		const { port, user } = this;
		if (!port || !user || this.busy) return;
		this.busy = true;
		this.failed = false;
		try {
			const file = await exportAccount(port, user.uid);
			const url = URL.createObjectURL(
				new Blob([file.content], { type: file.mimeType }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = file.fileName;
			link.click();
			URL.revokeObjectURL(url);
		} catch {
			this.failed = true;
		} finally {
			this.busy = false;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-export-data-button": PlanuExportDataButton;
	}
}
