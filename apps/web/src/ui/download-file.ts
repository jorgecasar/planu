/**
 * Delivers a text to the user as a downloadable file.
 *
 * It is the only impure part of the export, which is why it lives here and
 * not in `domain/`: everything that decides *what* the file contains is
 * tested as a string, and what's left —creating the `Blob`, the object URL,
 * clicking the link and revoking it— is deliberately trivial.
 *
 * No network: the file is built in the browser, so there is no server that
 * gets to see the contents of a private calendar.
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

	// In the document and not detached: some browsers ignore the `click()` of
	// a link that is not in the tree.
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	// One second, not zero: the download that just started still has to read
	// the object URL, and revoking it before then cancels it in some browsers.
	// The margin is free —a `Blob` in memory— and the next tick has fallen
	// short in more than one browser.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
