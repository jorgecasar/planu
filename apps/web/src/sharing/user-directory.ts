/**
 * A minimal user directory.
 *
 * Inviting someone by email means turning that email into a `uid`, and
 * Firebase Auth exposes no directory to clients: `getUserByEmail()` belongs to
 * the Admin SDK. So each user publishes their own entry, keyed by the hash of
 * their email.
 *
 * See docs/adr/0007-client-side-user-directory.md.
 *
 * The Firestore reads and writes that actually publish and look up
 * directory entries live in `infrastructure/firebase/sharing-adapter.ts`
 * (`SharingPort`), not here: this file keeps only what has no reason to touch
 * Firebase at all — the hash, and the collection names both the adapter and
 * `account-data-adapter.ts` need to agree on.
 */

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

/** Offers to an email with no account yet; see ADR 0012. */
export const PENDING_INVITES_BY_EMAIL_COLLECTION = "eventInvitesByEmail";

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
