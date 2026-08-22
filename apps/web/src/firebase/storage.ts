import {
	type FirebaseStorage,
	getDownloadURL,
	ref,
	uploadBytesResumable,
} from "firebase/storage";

/**
 * Uploads a file reporting progress and resolves with its download URL.
 *
 * The path must be `events/{uid}/...`: it is the only one that the Storage
 * rules allow writing to, because the uid in the path is what makes
 * ownership checkable. See `storage.rules`.
 */
export function uploadFile(
	storage: FirebaseStorage,
	file: File,
	path: string,
	onProgress?: (percent: number) => void,
): Promise<string> {
	return new Promise((resolve, reject) => {
		// Unique name so two simultaneous uploads don't clobber each other.
		// The original name is sanitized, not trusted: it's user-controlled,
		// and a `/` in it would add path segments the Storage rules don't
		// expect instead of escaping them (the SDK doesn't resolve `..`).
		const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
		const fileName = `${Date.now()}_${safeName}`;
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
