import type { Firestore } from "firebase-admin/firestore";

export interface DirectoryDeps {
	readonly firestore: Firestore;
}

/**
 * Deletes the profile of a deleted account and every directory entry that
 * points at it. The directory is keyed by the hash of an email, but each entry
 * carries the uid that wrote it (`firestore.rules`: `uid == request.auth.uid`),
 * so it is found by that uid: it also catches the entries of earlier emails
 * and never touches another account's entry, which a lookup by the email of
 * the deleted record could.
 */
export async function sweepDirectory(
	uid: string,
	{ firestore }: DirectoryDeps,
): Promise<void> {
	// An empty uid would match nothing useful; a slash would change the path.
	if (uid.length === 0 || uid.includes("/")) {
		throw new Error("sweepDirectory needs the uid of the deleted account");
	}

	await firestore.doc(`userProfiles/${uid}`).delete();
	const entries = await firestore
		.collection("userDirectory")
		.where("uid", "==", uid)
		.get();
	await Promise.all(entries.docs.map((entry) => entry.ref.delete()));
}
