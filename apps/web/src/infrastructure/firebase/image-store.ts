import {
	type FirebaseStorage,
	getDownloadURL,
	ref,
	uploadBytesResumable,
} from "firebase/storage";
import type { ImageStorePort } from "../../application/ports/image-store.js";

/**
 * Único adaptador de almacén de imágenes: el resto de la aplicación conoce
 * `ImageStorePort`, no `FirebaseStorage`.
 *
 * `prefix` debe ser `events/{uid}`: es la única ruta que las reglas de
 * Storage permiten escribir, porque el uid en la ruta es lo que hace
 * comprobable la propiedad. Ver `storage.rules`.
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
		return new Promise((resolve, reject) => {
			// Nombre único para que dos subidas simultáneas no se pisen.
			const fileName = `${Date.now()}_${file.name}`;
			const task = uploadBytesResumable(
				ref(this.#storage, `${prefix}/${fileName}`),
				file,
			);

			task.on(
				"state_changed",
				(snapshot) => {
					onProgress?.((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
				},
				reject,
				() => {
					getDownloadURL(task.snapshot.ref).then(resolve).catch(reject);
				},
			);
		});
	}
}
