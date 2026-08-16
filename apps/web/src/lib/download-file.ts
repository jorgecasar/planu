/**
 * Entrega un texto al usuario como fichero descargable.
 *
 * Es la única parte impura de la exportación y por eso está aquí y no en
 * `domain/`: todo lo que decide *qué* contiene el fichero se prueba como una
 * cadena, y lo que queda —crear el `Blob`, el object URL, pinchar el enlace y
 * revocarlo— es trivial a propósito.
 *
 * Sin red: el fichero se construye en el navegador, así que no hay servidor
 * que vea el contenido de una agenda privada.
 */
export function downloadTextFile(
	content: string,
	fileName: string,
	mimeType: string,
): void {
	const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;

	// En el documento y no suelto: hay navegadores que ignoran el `click()` de
	// un enlace que no está en el árbol.
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	// Un segundo, no cero: la descarga que acaba de arrancar todavía tiene que
	// leer el object URL, y revocarlo antes la cancela en algunos navegadores.
	// El margen es gratis —un `Blob` en memoria— y el turno siguiente se ha
	// quedado corto en más de un navegador.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
