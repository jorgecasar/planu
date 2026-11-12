import { msg } from "@lit/localize";
import type { ReactiveControllerHost } from "lit";
import type { ImageStorePort } from "../application/ports/image-store.js";
import type { SessionUser } from "../application/ports/session.js";

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
}
