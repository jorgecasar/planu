/**
 * Almacén de imágenes de portada. Firebase es un detalle de
 * `infrastructure/`: `event-editor.ts` no debe conocer `FirebaseStorage`,
 * `uploadBytesResumable` ni `getDownloadURL`.
 */
export interface ImageStorePort {
	/**
	 * Sube un fichero bajo el prefijo de un usuario e informa del progreso.
	 * Resuelve con la URL de descarga.
	 *
	 * `prefix` y no una ruta completa: quien implementa decide el nombre de
	 * fichero final —hoy, único por marca de tiempo, para que dos subidas
	 * simultáneas no se pisen—.
	 */
	upload(
		file: File,
		prefix: string,
		onProgress?: (percent: number) => void,
	): Promise<string>;
}
