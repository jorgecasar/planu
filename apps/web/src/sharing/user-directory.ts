/**
 * A minimal user directory.
 *
 * Inviting someone by email means turning that email into a `uid`, and
 * Firebase Auth exposes no directory to clients: `getUserByEmail()` belongs to
 * the Admin SDK. So each user publishes their own entry, keyed by the hash of
 * their email.
 *
 * See docs/adr/0007-client-side-user-directory.md.
 */

import type { User } from "firebase/auth";
import { doc, type Firestore, getDoc, setDoc } from "firebase/firestore";

export const DIRECTORY_COLLECTION = "userDirectory";

/**
 * A second index, by uid.
 *
 * The directory is keyed by the email hash because that is how you look up
 * someone to invite. But an event stores **uids**, and showing the guest list
 * means walking the other way. A hash does not invert, hence this index.
 *
 * It carries no email: sharing an event with you should not tell everyone else
 * your address.
 */
export const PROFILES_COLLECTION = "userProfiles";

/** What is published about each user. Nothing else: the rule enforces it. */
export interface DirectoryEntry {
	uid: string;
	displayName: string;
	photoURL: string;
}

/** How a guest is shown in the list. */
export interface PublicProfile {
	displayName: string;
	photoURL: string;
}

/**
 * SHA-256, hex, of the normalised email.
 *
 * It must match character for character what
 * `hashing.sha256(email.lower()).toHexString().lower()` produces in the rules,
 * which is what decides whether you may write that document.
 *
 * The email is trimmed and lowercased because whoever invites types it by
 * hand: unnormalised, "Ana@Example.com " would be a different person.
 */
export async function emailHash(email: string): Promise<string> {
	const normalized = email.trim().toLowerCase();
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(normalized),
	);

	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Publishes or refreshes the current user's entry.
 *
 * **Only if their email is verified.** Firebase Auth happily lets anyone
 * register with any address, so without this condition signing up with someone
 * else's email would be enough to collect their invitations. The rule enforces
 * it anyway; this just avoids a write that was going to bounce.
 */
export async function publishDirectoryEntry(
	firestore: Firestore,
	user: User,
): Promise<void> {
	if (!user.email || !user.emailVerified) return;

	const entry: DirectoryEntry = {
		uid: user.uid,
		displayName: user.displayName ?? "",
		photoURL: user.photoURL ?? "",
	};

	await Promise.all([
		setDoc(
			doc(firestore, DIRECTORY_COLLECTION, await emailHash(user.email)),
			entry,
		),
		setDoc(doc(firestore, PROFILES_COLLECTION, user.uid), {
			displayName: entry.displayName,
			photoURL: entry.photoURL,
		}),
	]);
}

/**
 * Finds who an email belongs to, or `null` if they have no account.
 *
 * A `get` by exact id, never a query: the rule forbids listing the collection,
 * which is what separates checking an address you already know from
 * downloading the whole census.
 */
export async function findUserByEmail(
	firestore: Firestore,
	email: string,
): Promise<DirectoryEntry | null> {
	const snapshot = await getDoc(
		doc(firestore, DIRECTORY_COLLECTION, await emailHash(email)),
	);

	return snapshot.exists() ? (snapshot.data() as DirectoryEntry) : null;
}

/**
 * How to display each of these uids.
 *
 * One `get` each rather than a query, because listing is closed. With the cap
 * of 20 guests per event that is at most 21 reads, and only when the share
 * dialog opens.
 *
 * A uid with no published profile is not an error: it is someone who has not
 * signed in again since the directory existed.
 */
export async function findProfiles(
	firestore: Firestore,
	uids: readonly string[],
): Promise<Map<string, PublicProfile>> {
	const entries = await Promise.all(
		uids.map(async (uid) => {
			const snapshot = await getDoc(
				doc(firestore, PROFILES_COLLECTION, uid),
			).catch(() => null);

			return snapshot?.exists()
				? ([uid, snapshot.data() as PublicProfile] as const)
				: null;
		}),
	);

	return new Map(entries.filter((entry) => entry !== null));
}
