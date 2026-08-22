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
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	type Firestore,
	getDoc,
	query,
	serverTimestamp,
	setDoc,
	type Timestamp,
	updateDoc,
	where,
	writeBatch,
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

/**
 * Offers the event to someone, or edits/re-offers an existing offer. Nothing
 * changes for them until they accept.
 *
 * The write's shape depends on what, if anything, is already there — the
 * rules require it, not just style:
 *
 * - No prior invitation, or one already decided (`accepted`/`declined`):
 *   a fresh `pending` offer with `createdAt` set by the server. Inviting
 *   someone who already declined, or re-inviting after removing them, both
 *   start a new offer with its own date rather than resurrecting the old
 *   one — matched on the rule side by `ownerReoffers()`, which likewise
 *   pins `createdAt` to `request.time`.
 * - A `pending` invitation already sitting there: this is an edit, not a
 *   new offer, so `createdAt` carries over unchanged. `ownerEditsWhilePending()`
 *   enforces exactly that — a full replace with a fresh timestamp would
 *   deny the write, since a client-chosen `createdAt` can never match what
 *   the rule expects. Skipping the read here and letting `setDoc` collide
 *   with a still-pending row is what silently broke "invite someone twice
 *   to fix a typo'd role" before this fix: `PERMISSION_DENIED` on every
 *   retry, because a fresh timestamp never equals the stored one.
 */
export async function inviteToEvent(
	firestore: Firestore,
	invite: Omit<EventInvite, "id" | "status" | "createdAt" | "decidedAt">,
): Promise<void> {
	const ref = doc(
		firestore,
		INVITES_COLLECTION,
		inviteId(invite.eventId, invite.inviteeUid),
	);
	const existing = await getDoc(ref);
	const createdAt =
		existing.exists() && existing.data()["status"] === "pending"
			? existing.data()["createdAt"]
			: serverTimestamp();

	await setDoc(ref, {
		eventId: invite.eventId,
		eventTitle: invite.eventTitle,
		inviteeUid: invite.inviteeUid,
		inviteeEmail: invite.inviteeEmail,
		invitedBy: invite.invitedBy,
		invitedByName: invite.invitedByName,
		role: invite.role,
		status: "pending",
		createdAt,
		decidedAt: null,
	});
}

/**
 * Joins the event and marks the invitation accepted, atomically.
 *
 * Updating the invitation rather than deleting it is what turns a decision
 * into a record. It also has to happen in the same batch as the membership
 * write: the rule requires the invitation to already read `accepted` by the
 * time the event write is evaluated, or the whole batch is denied — see
 * `acceptsInvite()` in `firestore.rules`.
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
	batch.update(doc(firestore, INVITES_COLLECTION, invite.id), {
		status: "accepted",
		decidedAt: serverTimestamp(),
	});

	await batch.commit();
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

/** Moves a declined invitation back to pending, so it can be decided again. */
export async function reconsiderInvite(
	firestore: Firestore,
	invite: Pick<EventInvite, "id">,
): Promise<void> {
	await updateDoc(doc(firestore, INVITES_COLLECTION, invite.id), {
		status: "pending",
		decidedAt: null,
	});
}

/** Revokes an invitation nobody has answered yet. Only the owner may call this. */
export async function revokeInvite(
	firestore: Firestore,
	invite: Pick<EventInvite, "id">,
): Promise<void> {
	await deleteDoc(doc(firestore, INVITES_COLLECTION, invite.id));
}
