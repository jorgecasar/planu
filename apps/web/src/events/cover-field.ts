import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import { msg } from "@lit/localize";
import { css, html, nothing, type ReactiveControllerHost } from "lit";
import type { ImageStorePort } from "../application/ports/image-store.js";
import type { SessionUser } from "../application/ports/session.js";
import { renderFileButton } from "./file-button.js";

/** Matches the limit in storage.rules; checking it here gives a better message. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Host = Pick<ReactiveControllerHost, "requestUpdate">;

export interface CoverFieldOptions {
	getImageStore: () => ImageStorePort | undefined;
	getUser: () => SessionUser | null | undefined;
	/** `error` is the channel for the whole dialog, not only for the cover. */
	setError: (message: string) => void;
}

/**
 * The editor's cover image: its URL, the upload in flight and its
 * progress. A controller, like `TagField`: the form reads `imageUrl` on
 * save and the save button waits on `uploading`.
 */
export class CoverField {
	imageUrl = "";
	uploading = false;
	progress = 0;

	readonly #host: Host;
	readonly #options: CoverFieldOptions;

	constructor(host: Host, options: CoverFieldOptions) {
		this.#host = host;
		this.#options = options;
	}

	reset(imageUrl: string): void {
		this.imageUrl = imageUrl;
		this.progress = 0;
		this.#host.requestUpdate();
	}

	readonly onFile = async (domEvent: globalThis.Event): Promise<void> => {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const { getImageStore, getUser, setError } = this.#options;
		const imageStore = getImageStore();
		const user = getUser();
		if (!imageStore || !user) return;

		// The rules would reject the file anyway, but with a permissions
		// error that explains nothing to the user.
		if (file.size >= MAX_IMAGE_BYTES) {
			setError(msg("Images must be smaller than 5 MB."));
			input.value = "";
			return;
		}

		setError("");
		this.uploading = true;
		this.progress = 0;
		this.#host.requestUpdate();
		try {
			this.imageUrl = await imageStore.upload(
				file,
				`events/${user.uid}`,
				(percent) => {
					this.progress = percent;
					this.#host.requestUpdate();
				},
			);
		} catch {
			setError(msg("The image could not be uploaded. Please try again."));
		} finally {
			this.uploading = false;
			input.value = "";
			this.#host.requestUpdate();
		}
	};

	readonly remove = (): void => {
		this.imageUrl = "";
		this.#host.requestUpdate();
	};

	/** Its markup goes in the host's shadow root, styled by `coverFieldStyles`. */
	render() {
		return html`
			<div class="cover">
				<label for="cover">${msg("Cover image")}</label>
				${this.imageUrl ? html`<img src=${this.imageUrl} alt=${msg("Cover image preview")} />` : nothing}
				${renderFileButton({
					id: "cover",
					accept: "image/png, image/jpeg, image/webp, image/gif, image/avif",
					disabled: this.uploading,
					onChange: this.onFile,
				})}
				${
					this.uploading
						? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
						: nothing
				}
				${
					this.imageUrl
						? html`<wa-button
								type="button"
								appearance="plain"
								@click=${this.remove}
							>
								${msg("Remove image")}
							</wa-button>`
						: nothing
				}
			</div>
		`;
	}
}

export const coverFieldStyles = css`
	.cover {
		display: flex;
		flex-direction: column;
		gap: var(--wa-space-xs);
	}

	img {
		inline-size: 100%;
		block-size: 10rem;
		object-fit: cover;
		border-radius: var(--wa-border-radius-m);
	}
`;
