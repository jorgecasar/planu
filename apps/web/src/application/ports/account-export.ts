import type { AccountExportSource } from "../../domain/account-export.js";

/**
 * What the "download my data" use case needs: everything the person can read
 * about themselves, with their own permissions and nothing else.
 *
 * Deliberately narrow, like `AccountDataPort`: one read, keyed by the uid of
 * the signed-in account. Shaping and filtering belong to the domain.
 */
export interface AccountExportPort {
	read(uid: string): Promise<AccountExportSource>;
}
