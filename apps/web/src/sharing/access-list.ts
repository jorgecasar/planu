import { msg } from "@lit/localize";
import type { ReactiveControllerHost } from "lit";
import type { SessionUser } from "../application/ports/session.js";
import type {
	PendingInviteSummary,
	PublicProfile,
	SharingPort,
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

type Host = Pick<ReactiveControllerHost, "requestUpdate">;

export interface AccessListOptions {
	getSharing: () => SharingPort | undefined;
	getEvent: () => StoredEvent | undefined;
	getUser: () => SessionUser | null | undefined;
}

/**
 * The share dialog's list of people with access. A controller, like
 * `CoverField`: the dialog renders `people` and counts the pending ones
 * against the guest cap.
 */
export class AccessList {
	people: Person[] = [];
	loading = false;
	/** Set when the pending query failed: the list is short and says so. */
	incomplete = false;

	readonly #host: Host;
	readonly #options: AccessListOptions;

	constructor(host: Host, options: AccessListOptions) {
		this.#host = host;
		this.#options = options;
	}

	/**
	 * Cleared first, or reopening for another event flashes the previous
	 * event's people while the new ones resolve.
	 */
	reset(): void {
		this.people = [];
		this.loading = true;
		this.incomplete = false;
		this.#host.requestUpdate();
	}

	/**
	 * Members and pending invitations, in one list.
	 *
	 * Names are resolved when the dialog opens and never stored on the event: if
	 * someone changes theirs, the new one shows up with nothing to migrate.
	 *
	 * Pending invitations are queried by `invitedBy` because that is what the
	 * rule allows the owner to read, then narrowed to this event here. Filtering
	 * by `eventId` in the query would need a composite index and would not be
	 * readable anyway.
	 */
	readonly load = async (): Promise<void> => {
		const sharing = this.#options.getSharing();
		const event = this.#options.getEvent();
		const user = this.#options.getUser();
		if (!sharing || !event || !user) {
			// Or the dialog sits on "Loading…" forever when it opens before the
			// contexts have arrived.
			this.loading = false;
			this.#host.requestUpdate();
			return;
		}

		const memberUids = (event.memberIds ?? []).filter(
			(uid) => uid !== event.userId,
		);

		// Decided invitations now survive in Firestore instead of being
		// deleted, so this must be narrowed to `pending` explicitly: an
		// accepted one would otherwise show its person twice, once as a
		// member and once as a stale offer, and a declined one would keep
		// offering "cancel" on something already answered.
		const invited = await sharing
			.listPendingInvites(event.id, user.uid)
			.catch(() => null);

		// Swallowing this left the owner looking at a list with no pending
		// invitations in it and no hint that any were missing — and that list is
		// what they decide who to remove from.
		this.incomplete = invited === null;
		this.#host.requestUpdate();

		const profiles = await sharing.findProfiles([
			...memberUids,
			...(invited ?? []).map((row) => row.inviteeUid),
		]);

		this.loading = false;
		this.people = toPeople(event, memberUids, invited ?? [], profiles);
		this.#host.requestUpdate();
	};
}
