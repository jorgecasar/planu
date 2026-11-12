import type { FirebaseStorage } from "firebase/storage";
import type { ImageStorePort } from "../../application/ports/image-store.js";
import { uploadFile } from "./storage.js";

/**
 * The only image-store adapter: the rest of the application knows
 * `ImageStorePort`, not `FirebaseStorage`.
 *
 * `prefix` must be `events/{uid}`: it's the only path Storage rules allow
 * writing to, because the uid in the path is what makes ownership
 * checkable. See `storage.rules`.
 *
 * Delegates to `uploadFile()` (`./storage.ts`) instead of
 * reimplementing the upload wiring: `ai-event-generator.ts` still calls
 * that function directly, and two copies of the same
 * `uploadBytesResumable`/`state_changed`/`getDownloadURL` sequence would
 * drift the moment one of them changed.
 */
export class FirebaseImageStore implements ImageStorePort {
	readonly #storage: FirebaseStorage;

	constructor(storage: FirebaseStorage) {
		this.#storage = storage;
	}

	upload(
		file: File,
		prefix: string,
		onProgress?: (percent: number) => void,
	): Promise<string> {
		return uploadFile(this.#storage, file, prefix, onProgress);
	}
}
