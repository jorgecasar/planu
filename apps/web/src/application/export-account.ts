import { buildAccountExport } from "../domain/account-export.js";
import type { AccountExportPort } from "./ports/account-export.js";

/** A file ready to be handed to the browser as a download. */
export interface ExportFile {
	fileName: string;
	mimeType: string;
	content: string;
}

/**
 * Reads the account's data through the port and turns it into a JSON file.
 * Failures from the port reach the caller: a half-empty export that looked
 * complete would be worse than an error.
 */
export async function exportAccount(
	port: AccountExportPort,
	uid: string,
	now: Date = new Date(),
): Promise<ExportFile> {
	const source = await port.read(uid);
	return {
		fileName: `planu-export-${now.toISOString().slice(0, 10)}.json`,
		mimeType: "application/json",
		content: JSON.stringify(buildAccountExport(source, now), null, 2),
	};
}
