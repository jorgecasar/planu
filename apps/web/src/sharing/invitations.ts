/**
 * Invitations: a persistent record, not an ephemeral notice.
 *
 * Membership is consensual: the owner offers, and only the invitee turns that
 * offer into membership. Without this, knowing someone's email was enough to
 * push events into their listing unasked — which is spam with guaranteed
 * delivery inside the interface, and the recipient could not even delete it.
 *
 * Since docs/spec-invitation-activity.md, deciding an invitation no longer
 * deletes it: it moves to `accepted` or `declined` and stays consultable.
 * This is also what makes removing someone from an event final on their
 * side — an invitation already used cannot be replayed to walk back in, only
 * the owner can put it back to `pending`. See `firestore.rules`, function
 * `acceptsInvite()`.
 *
 * See docs/adr/0007-client-side-user-directory.md.
 */

import {
	collection,
	doc,
	type Firestore,
	query,
	serverTimestamp,
	type Timestamp,
	updateDoc,
	where,
} from "firebase/firestore";
import type { EventRole } from "../lib/types.js";

export const INVITES_COLLECTION = "eventInvites";

export type InviteStatus = "pending" | "accepted" | "declined";

export interface EventInvite {
	id: string;
	eventId: string;
	/** Carried on the invitation because the invitee cannot read the event yet. */
	eventTitle: string;
	inviteeUid: string;
	/**
	 * The address the owner typed, shown back to them.
	 *
	 * It lives on the invitation and not on the public profile because only two
	 * people ever read one: the owner, who already knows the address because
	 * they wrote it, and its recipient. On `userProfiles` it would instead hand
	 * every guest of an event the addresses of all the others.
	 */
	inviteeEmail: string;
	invitedBy: string;
	invitedByName: string;
	role: EventRole;
	status: InviteStatus;
	createdAt: Timestamp | null;
	decidedAt: Timestamp | null;
}

/**
 * The id ties an invitation to its event and its recipient.
 *
 * The accept rule looks it up by this exact name — no query — and it also means
 * one event cannot hold two live invitations for the same person.
 */
export function inviteId(eventId: string, inviteeUid: string): string {
	return `${eventId}_${inviteeUid}`;
}

/** The query for someone's pending invitations — the inbox shows only these. */
export function invitesFor(firestore: Firestore, uid: string) {
	return query(
		collection(firestore, INVITES_COLLECTION),
		where("inviteeUid", "==", uid),
		where("status", "==", "pending"),
	);
}

/** Declines it. The record stays, so it can be reconsidered later. */
export async function declineInvite(
	firestore: Firestore,
	invite: Pick<EventInvite, "id">,
): Promise<void> {
	await updateDoc(doc(firestore, INVITES_COLLECTION, invite.id), {
		status: "declined",
		decidedAt: serverTimestamp(),
	});
}
