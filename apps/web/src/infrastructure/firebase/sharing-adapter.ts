/**
 * `SharingPort` adapter: the one file, along with its test, that knows
 * inviting, listing and managing an event's people touches Firestore.
 *
 * Moved here from `sharing/user-directory.ts`, which used to call Firestore
 * directly — see docs/adr/0007-client-side-user-directory.md for why a
 * client-side directory exists at all. `sharing/invitations.ts` stays where
 * it is and keeps its own `firebase/**` exemption: it is not this task's
 * scope, and `inviteToEvent`/`revokeInvite` below just call straight through
 * to it with the `Firestore` instance this adapter already holds.
 */

import {
	collection,
	deleteDoc,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
} from "firebase/firestore";
import type { SessionUser } from "../../application/ports/session.js";
import type {
	DirectoryEntry,
	InviteOffer,
	PendingInviteSummary,
	PublicProfile,
	SharingPort,
} from "../../application/ports/sharing.js";
import type { EventRole } from "../../lib/types.js";
import {
	INVITES_COLLECTION,
	inviteToEvent as inviteToEventInCollection,
	revokeInvite as revokeInviteInCollection,
} from "../../sharing/invitations.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PENDING_INVITES_BY_EMAIL_COLLECTION,
	PROFILES_COLLECTION,
} from "../../sharing/user-directory.js";

export function createSharingAdapter(firestore: Firestore): SharingPort {
	return {
		async findUserByEmail(email: string): Promise<DirectoryEntry | null> {
			const snapshot = await getDoc(
				doc(firestore, DIRECTORY_COLLECTION, await emailHash(email)),
			);
			return snapshot.exists() ? (snapshot.data() as DirectoryEntry) : null;
		},

		async findProfiles(
			uids: readonly string[],
		): Promise<Map<string, PublicProfile>> {
			const entries = await Promise.all(
				uids.map(async (uid) => {
					const snapshot = await getDoc(
						doc(firestore, PROFILES_COLLECTION, uid),
					).catch(() => null);

					return snapshot?.exists()
						? ([uid, snapshot.data() as PublicProfile] as const)
						: null;
				}),
			);

			return new Map(entries.filter((entry) => entry !== null));
		},

		async listPendingInvites(
			eventId: string,
			invitedBy: string,
		): Promise<PendingInviteSummary[]> {
			const snapshot = await getDocs(
				query(
					collection(firestore, INVITES_COLLECTION),
					where("invitedBy", "==", invitedBy),
					where("eventId", "==", eventId),
					where("status", "==", "pending"),
				),
			);

			return snapshot.docs.map((row) => {
				const data = row.data();
				return {
					id: row.id,
					eventId: String(data["eventId"] ?? ""),
					inviteeUid: String(data["inviteeUid"] ?? ""),
					inviteeEmail: String(data["inviteeEmail"] ?? ""),
					role: (data["role"] === "editor" ? "editor" : "viewer") as EventRole,
				};
			});
		},

		async inviteToEvent(
			invite: InviteOffer & { inviteeUid: string },
		): Promise<void> {
			await inviteToEventInCollection(firestore, invite);
		},

		async offerInviteByEmail(offer: InviteOffer): Promise<void> {
			const ref = doc(
				firestore,
				PENDING_INVITES_BY_EMAIL_COLLECTION,
				`${offer.eventId}_${await emailHash(offer.inviteeEmail)}`,
			);
			const write = () =>
				setDoc(ref, {
					eventId: offer.eventId,
					eventTitle: offer.eventTitle,
					inviteeEmail: offer.inviteeEmail.trim().toLowerCase(),
					invitedBy: offer.invitedBy,
					invitedByName: offer.invitedByName,
					role: offer.role,
					createdAt: serverTimestamp(),
				});

			// The rules allow no update and hide a missing offer even from its
			// sender, so a re-offer shows up as a denied overwrite. If the delete
			// fails too, nothing was there and the first error stands.
			try {
				await write();
			} catch (error) {
				await deleteDoc(ref).catch(() => {
					throw error;
				});
				await write();
			}
		},

		async changeInviteRole(id: string, role: EventRole): Promise<void> {
			await updateDoc(doc(firestore, INVITES_COLLECTION, id), { role });
		},

		async revokeInvite(id: string): Promise<void> {
			await revokeInviteInCollection(firestore, { id });
		},

		async updateEventMembership(
			eventId: string,
			membership: { memberIds: string[]; roles: Record<string, EventRole> },
		): Promise<void> {
			await updateDoc(doc(firestore, "events", eventId), membership);
		},

		/**
		 * **Only if the email is verified.** Firebase Auth happily lets anyone
		 * register with any address, so without this condition signing up with
		 * someone else's email would be enough to collect their invitations.
		 * The rule enforces it anyway; this just avoids a write that was going
		 * to bounce.
		 */
		async publishDirectoryEntry(user: SessionUser): Promise<void> {
			if (!user.email || !user.emailVerified) return;

			const entry: DirectoryEntry = {
				uid: user.uid,
				displayName: user.displayName ?? "",
				photoURL: user.photoURL ?? "",
			};

			await Promise.all([
				setDoc(
					doc(firestore, DIRECTORY_COLLECTION, await emailHash(user.email)),
					entry,
				),
				setDoc(doc(firestore, PROFILES_COLLECTION, user.uid), {
					displayName: entry.displayName,
					photoURL: entry.photoURL,
				}),
			]);
		},
	};
}
