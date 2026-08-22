/**
 * Cover-image store. Firebase is a detail of `infrastructure/`:
 * `event-editor.ts` shouldn't know about `FirebaseStorage`,
 * `uploadBytesResumable`, or `getDownloadURL`.
 */
export interface ImageStorePort {
	/**
	 * Uploads a file under a user's prefix and reports progress. Resolves
	 * with the download URL.
	 *
	 * `prefix`, not a full path: whoever implements this decides the final
	 * file name — today, unique by timestamp, so two simultaneous uploads
	 * don't clobber each other.
	 */
	upload(
		file: File,
		prefix: string,
		onProgress?: (percent: number) => void,
	): Promise<string>;
}
