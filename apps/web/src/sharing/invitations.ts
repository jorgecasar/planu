/**
 * Pending invitations.
 *
 * Membership is consensual: the owner offers, and only the invitee turns that
 * offer into membership. Without this, knowing someone's email was enough to
 * push events into their listing unasked — which is spam with guaranteed
 * delivery inside the interface, and the recipient could not even delete it.
 *
 * See docs/adr/0007-client-side-user-directory.md.
 */

import {
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	type Firestore,
	query,
	setDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import type { EventRole } from "../lib/types.js";

export const INVITES_COLLECTION = "eventInvites";

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
}

/**
 * The id ties an invitation to its event and its recipient.
 *
 * The accept rule looks it up by this exact name — no query — and it also means
 * one event cannot hold two pending invitations for the same person.
 */
export function inviteId(eventId: string, inviteeUid: string): string {
	return `${eventId}_${inviteeUid}`;
}

/** The query for someone's pending invitations. */
export function invitesFor(firestore: Firestore, uid: string) {
	return query(
		collection(firestore, INVITES_COLLECTION),
		where("inviteeUid", "==", uid),
	);
}

/** Offers the event to someone. Nothing changes for them until they accept. */
export async function inviteToEvent(
	firestore: Firestore,
	invite: Omit<EventInvite, "id">,
): Promise<void> {
	await setDoc(
		doc(
			firestore,
			INVITES_COLLECTION,
			inviteId(invite.eventId, invite.inviteeUid),
		),
		{
			eventId: invite.eventId,
			eventTitle: invite.eventTitle,
			inviteeUid: invite.inviteeUid,
			inviteeEmail: invite.inviteeEmail,
			invitedBy: invite.invitedBy,
			invitedByName: invite.invitedByName,
			role: invite.role,
		},
	);
}

/**
 * Joins the event and clears the invitation, atomically.
 *
 * `arrayUnion` and the dotted `roles.<uid>` path are what make this possible
 * without reading the event first — which the invitee could not do anyway,
 * since reading requires being a member already.
 *
 * Both writes go in one batch: leaving the invitation behind would show the
 * offer again for an event already joined.
 */
export async function acceptInvite(
	firestore: Firestore,
	invite: EventInvite,
): Promise<void> {
	const batch = writeBatch(firestore);

	batch.update(doc(firestore, "events", invite.eventId), {
		memberIds: arrayUnion(invite.inviteeUid),
		[`roles.${invite.inviteeUid}`]: invite.role,
	});
	batch.delete(doc(firestore, INVITES_COLLECTION, invite.id));

	await batch.commit();
}

/** Declines it, or revokes it if you are the one who offered. */
export async function dismissInvite(
	firestore: Firestore,
	invite: Pick<EventInvite, "id">,
): Promise<void> {
	await deleteDoc(doc(firestore, INVITES_COLLECTION, invite.id));
}
