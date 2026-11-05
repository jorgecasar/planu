import { createContext } from "@lit/context";
import type { EventRole } from "../../lib/types.js";
import type { SessionUser } from "./session.js";

/**
 * What `share-dialog.ts` needs to invite, list and manage the people on an
 * event, plus the two triggers that keep the directory current
 * (`firebase-provider.ts`'s `onAuthStateChanged` and `profile-view.ts`'s "I
 * have verified it" button).
 *
 * Not a general events port: like `AccountDataPort`, it is deliberately
 * narrow — one component and its two triggers, not every operation the
 * `userDirectory`/`userProfiles`/`eventInvites` collections could ever
 * support. Widening it the day another use case needs more is fine; not
 * before.
 */

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

/** One live, undecided invitation — the shape `share-dialog.ts` shows. */
export interface PendingInviteSummary {
	id: string;
	eventId: string;
	inviteeUid: string;
	inviteeEmail: string;
	role: EventRole;
}

/** What it takes to offer an event, to a uid or to an email with no account. */
export interface InviteOffer {
	eventId: string;
	eventTitle: string;
	inviteeEmail: string;
	invitedBy: string;
	invitedByName: string;
	role: EventRole;
}

export interface SharingPort {
	/**
	 * Finds who an email belongs to, or `null` if they have no account.
	 *
	 * `null` means the lookup succeeded and found nothing. A rejected promise
	 * means the lookup itself failed and must not be mistaken for "no
	 * account"; see `share-dialog.ts`'s `#onInvite`, the only caller.
	 */
	findUserByEmail(email: string): Promise<DirectoryEntry | null>;

	/** How to display each of these uids; a uid with no entry is not an error. */
	findProfiles(uids: readonly string[]): Promise<Map<string, PublicProfile>>;

	/** Live, pending invitations for one event, offered by one owner. */
	listPendingInvites(
		eventId: string,
		invitedBy: string,
	): Promise<PendingInviteSummary[]>;

	/** Offers the event to a known uid, or edits an existing pending offer. */
	inviteToEvent(invite: InviteOffer & { inviteeUid: string }): Promise<void>;

	/**
	 * Offers the event to an email with no account yet, replacing any offer
	 * already made to it (ADR 0012).
	 */
	offerInviteByEmail(offer: InviteOffer): Promise<void>;

	/** Changes the role on a pending invitation nobody has decided yet. */
	changeInviteRole(id: string, role: EventRole): Promise<void>;

	/** Revokes an invitation nobody has answered yet. */
	revokeInvite(id: string): Promise<void>;

	/** Rewrites an event's membership — adding, removing or re-roling a guest. */
	updateEventMembership(
		eventId: string,
		membership: { memberIds: string[]; roles: Record<string, EventRole> },
	): Promise<void>;

	/** Publishes or refreshes the current user's directory entry. */
	publishDirectoryEntry(user: SessionUser): Promise<void>;
}

/**
 * The port's Lit context. No safe no-op default: there is no harmless way to
 * satisfy an invite or a directory lookup, same shape as `accountDataContext`.
 */
export const sharingContext = createContext<SharingPort | undefined>(
	Symbol("planu-sharing"),
);
