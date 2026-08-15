import {
	type FirebaseStorage,
	getDownloadURL,
	ref,
	uploadBytesResumable,
} from "firebase/storage";

/**
 * Sube un fichero informando del progreso y resuelve con su URL de descarga.
 *
 * La ruta debe ser `events/{uid}/...`: es la única que las reglas de Storage
 * permiten escribir, porque el uid en la ruta es lo que hace comprobable la
 * propiedad. Ver `storage.rules`.
 */
export function uploadFile(
	storage: FirebaseStorage,
	file: File,
	path: string,
	onProgress?: (percent: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		// Nombre único para que dos subidas simultáneas no se pisen.
		const fileName = `${Date.now()}_${file.name}`;
		const task = uploadBytesResumable(
			ref(storage, `${path}/${fileName}`),
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
