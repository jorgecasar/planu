import {
	FieldPath,
	FieldValue,
	type Firestore,
} from "firebase-admin/firestore";

export interface ReferenceDeps {
	readonly firestore: Firestore;
}

/**
 * Cleans what a deleted account left in the data of other people: its place in
 * their events, the invitations it received or sent, and the email offers it
 * made. Everything is read at the moment it runs and keyed by the verified
 * uid, so a second run on a clean account does nothing.
 *
 * Tombstones (ADR 0015) that name the account are left alone: what to do with
 * them is the owner's decision, still open (GH-154, T4).
 */
export async function sweepReferences(
	uid: string,
	{ firestore }: ReferenceDeps,
): Promise<void> {
	// An empty uid would match nothing useful; a slash would change the path.
	if (uid.length === 0 || uid.includes("/")) {
		throw new Error("sweepReferences needs the uid of the deleted account");
	}

	await leaveEventsOfOthers(firestore, uid);
	await deleteInvitations(firestore, uid);
	await deleteEmailOffers(firestore, uid);
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
