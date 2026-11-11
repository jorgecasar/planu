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
 * The reads and writes live in `infrastructure/firebase/sharing-adapter.ts`,
 * behind `SharingPort`. See docs/adr/0007-client-side-user-directory.md.
 */

export const INVITES_COLLECTION = "eventInvites";

/**
 * The id ties an invitation to its event and its recipient.
 *
 * The accept rule looks it up by this exact name — no query — and it also means
 * one event cannot hold two live invitations for the same person.
 */
export function inviteId(eventId: string, inviteeUid: string): string {
	return `${eventId}_${inviteeUid}`;
}
