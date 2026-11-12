import { msg } from "@lit/localize";
import type {
	PendingInviteSummary,
	PublicProfile,
} from "../application/ports/sharing.js";
import type { EventRole, StoredEvent } from "../lib/types.js";

/** One row of the access list: a member, or an offer nobody has taken yet. */
export interface Person {
	/** The uid for members, the invitation id for pending ones. */
	key: string;
	uid: string;
	role: EventRole;
	name: string;
	/** Known for pending invitations only: it is what the owner typed. */
	email: string;
	photoURL: string;
	pending: boolean;
}

/** The event's guests first, then the offers still waiting for an answer. */
export function toPeople(
	event: StoredEvent,
	memberUids: readonly string[],
	invited: readonly PendingInviteSummary[],
	profiles: ReadonlyMap<string, PublicProfile>,
): Person[] {
	const named = (uid: string) => profiles.get(uid)?.displayName || msg("Guest");

	return [
		...memberUids.map((uid) => ({
			key: uid,
			uid,
			role: event.roles?.[uid] ?? "viewer",
			// Anyone who has not signed in again since the directory existed has
			// no published profile. Better "Guest" than a raw uid.
			name: named(uid),
			// Members are shown by name: their address is not published
			// anywhere, and republishing it would leak every guest's address
			// to every other guest.
			email: "",
			photoURL: profiles.get(uid)?.photoURL ?? "",
			pending: false,
		})),
		...invited.map((row) => ({
			key: row.id,
			uid: row.inviteeUid,
			role: row.role,
			name: named(row.inviteeUid),
			email: row.inviteeEmail,
			photoURL: profiles.get(row.inviteeUid)?.photoURL ?? "",
			pending: true,
		})),
	];
}
