import { createHash } from "node:crypto";

/** What the sweep will do first: say which account was deleted, without its uid. */
export type LogLine = (
	message: string,
	data: { readonly uidHash: string },
) => void;

/**
 * One-way, truncated sha256 of the uid. The same account always yields the same
 * value, so the log lines of a failed or retried sweep can be correlated
 * without keeping the identifier of someone who asked to be erased.
 */
export function hashUid(uid: string): string {
	return createHash("sha256").update(uid).digest("hex").slice(0, 16);
}

export function logDeletedUser(uid: string, log: LogLine): void {
	if (uid.length === 0) {
		throw new Error("logDeletedUser needs the uid of the deleted account");
	}
	log("account deleted", { uidHash: hashUid(uid) });
}
