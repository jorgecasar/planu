import { createHash } from "node:crypto";
import {
	FieldPath,
	FieldValue,
	type Firestore,
} from "firebase-admin/firestore";

export interface ReferenceDeps {
	readonly firestore: Firestore;
	/** Email of the deleted account, when the deletion event carries one. */
	readonly email?: string | undefined;
}

/**
 * Cleans what a deleted account left in the data of other people: its place in
 * their events, the invitations it received or sent, and the email offers it
 * made. Everything is read at the moment it runs and keyed by the verified
 * uid, so a second run on a clean account does nothing.
 *
 * Tombstones (ADR 0015) that name the account are left alone: what to do with
 * them is the owner's decision, still open (#413); HU-433 deliberately does
 * not remove them.
 */
export async function sweepReferences(
	uid: string,
	{ firestore, email }: ReferenceDeps,
): Promise<void> {
	// An empty uid would match nothing useful; a slash would change the path.
	if (uid.length === 0 || uid.includes("/")) {
		throw new Error("sweepReferences needs the uid of the deleted account");
	}

	await leaveEventsOfOthers(firestore, uid);
	await deleteInvitations(firestore, uid);
	await deleteEmailOffers(firestore, uid);
	await deleteOffersToEmail(firestore, uid, email);
}

/**
 * Deletes the offers other people addressed to this account's email. The
 * hashes come from the current email and from the directory entries the
 * account wrote (earlier emails), so this must run before the directory sweep.
 */
async function deleteOffersToEmail(
	firestore: Firestore,
	uid: string,
	email: string | undefined,
): Promise<void> {
	const hashes = new Set<string>();
	if (email !== undefined && email.length > 0) {
		// Same recipe as the rules: sha256 of the lowercased email, in hex.
		hashes.add(createHash("sha256").update(email.toLowerCase()).digest("hex"));
	}
	const entries = await firestore
		.collection("userDirectory")
		.where("uid", "==", uid)
		.get();
	for (const entry of entries.docs) hashes.add(entry.id);

	await Promise.all(
		[...hashes].map(async (hash) => {
			const offers = await firestore
				.collection("eventInvitesByEmail")
				.where("emailHash", "==", hash)
				.get();
			await Promise.all(offers.docs.map((offer) => offer.ref.delete()));
		}),
	);
}

async function leaveEventsOfOthers(
	firestore: Firestore,
	uid: string,
): Promise<void> {
	const member = await firestore
		.collection("events")
		.where("memberIds", "array-contains", uid)
		.get();
	await Promise.all(
		member.docs
			// Its own events are the business of the sweep of owned data.
			.filter((event) => event.get("userId") !== uid)
			.map((event) =>
				event.ref.update(
					"memberIds",
					FieldValue.arrayRemove(uid),
					new FieldPath("roles", uid),
					FieldValue.delete(),
				),
			),
	);
}

async function deleteInvitations(
	firestore: Firestore,
	uid: string,
): Promise<void> {
	const [received, sent] = await Promise.all([
		firestore.collection("eventInvites").where("inviteeUid", "==", uid).get(),
		firestore.collection("eventInvites").where("invitedBy", "==", uid).get(),
	]);
	const doomed = new Map<string, FirebaseFirestore.DocumentReference>();
	for (const invite of sent.docs) doomed.set(invite.ref.path, invite.ref);
	for (const invite of received.docs) {
		if (invite.get("status") !== "removed") {
			doomed.set(invite.ref.path, invite.ref);
		}
	}
	await Promise.all([...doomed.values()].map((ref) => ref.delete()));
}

async function deleteEmailOffers(
	firestore: Firestore,
	uid: string,
): Promise<void> {
	const offers = await firestore
		.collection("eventInvitesByEmail")
		.where("invitedBy", "==", uid)
		.get();
	await Promise.all(offers.docs.map((offer) => offer.ref.delete()));
}
