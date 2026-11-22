/** What the sweep will do first: say which account was deleted. Nothing else yet. */
export type LogLine = (message: string, data: { readonly uid: string }) => void;

export function logDeletedUser(uid: string, log: LogLine): void {
	if (uid.length === 0) {
		throw new Error("logDeletedUser needs the uid of the deleted account");
	}
	log("account deleted", { uid });
}
