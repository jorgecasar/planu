/**
 * `SharingPort` adapter: the one file, along with its test, that knows
 * inviting, listing and managing an event's people touches Firestore.
 *
 * Moved here from `sharing/user-directory.ts` and `sharing/invitations.ts`,
 * which used to call Firestore directly — see
 * docs/adr/0007-client-side-user-directory.md for why a client-side
 * directory exists at all.
 */

import {
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	onSnapshot,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import type { SessionUser } from "../../application/ports/session.js";
import type {
	DirectoryEntry,
	InviteOffer,
	PendingInviteSummary,
	PublicProfile,
	ReceivedInvite,
	SharingPort,
} from "../../application/ports/sharing.js";
import type { EventRole } from "../../lib/types.js";
import { INVITES_COLLECTION, inviteId } from "../../sharing/invitations.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PENDING_INVITES_BY_EMAIL_COLLECTION,
	PROFILES_COLLECTION,
} from "../../sharing/user-directory.js";

/** Where `publishDirectoryEntry` reports how it went; wired by the provider. */
export type WriteRecorder = (
	operation: string,
	outcome: "success" | "permission-denied" | "failure",
	error?: unknown,
) => void;

/** A rule denial versus anything else; offline isn't one: `setDoc` waits. */
function outcomeOf(error: unknown): "permission-denied" | "failure" {
	const { code } = Object(error) as { code?: unknown };
	return code === "permission-denied" ? "permission-denied" : "failure";
}

export function createSharingAdapter(
	firestore: Firestore,
	record: WriteRecorder = () => {},
): SharingPort {
	/**
	 * The owner's own email offer for this event and address, if one is there.
	 * Left in place it outlives a uid invite and a removal: the removed guest
	 * erases their own record (ADR 0013) and claims it to get back in (GH-147).
	 * Listed rather than read: the rules hide a missing offer even from its
	 * sender, and deleting a missing one is denied, which would sink the batch.
	 */
	async function emailOfferTo(
		eventId: string,
		invitedBy: string,
		email: string,
	) {
		const id = `${eventId}_${await emailHash(email)}`;
		const snapshot = await getDocs(
			query(
				collection(firestore, PENDING_INVITES_BY_EMAIL_COLLECTION),
				where("invitedBy", "==", invitedBy),
				where("eventId", "==", eventId),
			),
		);
		// Not `documentId() == id`: a single-id query is checked against that
		// one document, and with no offer there the rule denies it.
		return snapshot.docs.find((row) => row.id === id)?.ref;
	}

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

		/**
		 * The write's shape depends on what, if anything, is already there —
		 * the rules require it, not just style:
		 *
		 * - No prior invitation, or one already decided (`accepted`/`declined`):
		 *   a fresh `pending` offer with `createdAt` set by the server. Inviting
		 *   someone who already declined, or re-inviting after removing them,
		 *   both start a new offer with its own date rather than resurrecting
		 *   the old one — matched on the rule side by `ownerReoffers()`, which
		 *   likewise pins `createdAt` to `request.time`.
		 * - A `pending` invitation already sitting there: this is an edit, not
		 *   a new offer, so `createdAt` carries over unchanged.
		 *   `ownerEditsWhilePending()` enforces exactly that — a full replace
		 *   with a fresh timestamp would deny the write, since a client-chosen
		 *   `createdAt` can never match what the rule expects. Skipping the
		 *   read here and letting `setDoc` collide with a still-pending row is
		 *   what silently broke "invite someone twice to fix a typo'd role"
		 *   before this fix: `PERMISSION_DENIED` on every retry, because a
		 *   fresh timestamp never equals the stored one.
		 */
		async inviteToEvent(
			invite: InviteOffer & { inviteeUid: string },
		): Promise<void> {
			const ref = doc(
				firestore,
				INVITES_COLLECTION,
				inviteId(invite.eventId, invite.inviteeUid),
			);
			const [existing, offer] = await Promise.all([
				getDoc(ref),
				emailOfferTo(invite.eventId, invite.invitedBy, invite.inviteeEmail),
			]);
			const createdAt =
				existing.exists() && existing.data()["status"] === "pending"
					? existing.data()["createdAt"]
					: serverTimestamp();

			const batch = writeBatch(firestore);
			if (offer) batch.delete(offer);
			batch.set(ref, {
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
			await batch.commit();
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
			await deleteDoc(doc(firestore, INVITES_COLLECTION, id));
		},

		watchReceivedInvites(uid, onChange) {
			return onSnapshot(
				query(
					collection(firestore, INVITES_COLLECTION),
					where("inviteeUid", "==", uid),
					where("status", "==", "pending"),
				),
				(snapshot) => {
					onChange(
						snapshot.docs.map((row) => {
							const data = row.data();
							return {
								id: row.id,
								eventId: String(data["eventId"] ?? ""),
								eventTitle: String(data["eventTitle"] ?? ""),
								inviteeUid: String(data["inviteeUid"] ?? ""),
								invitedByName: String(data["invitedByName"] ?? ""),
								role: data["role"] === "editor" ? "editor" : "viewer",
							};
						}),
					);
				},
				() => {},
			);
		},

		/**
		 * Updating the invitation rather than deleting it is what turns a
		 * decision into a record. It also has to happen in the same batch as
		 * the membership write: the rule requires the invitation to already
		 * read `accepted` by the time the event write is evaluated, or the
		 * whole batch is denied — see `acceptsInvite()` in `firestore.rules`.
		 */
		async acceptInvite(invite: ReceivedInvite, email?: string): Promise<void> {
			const batch = writeBatch(firestore);

			// The invitee may read their own offer id even when it is missing,
			// but deleting a missing one would deny the batch.
			if (email) {
				const offer = await getDoc(
					doc(
						firestore,
						PENDING_INVITES_BY_EMAIL_COLLECTION,
						`${invite.eventId}_${await emailHash(email)}`,
					),
				);
				if (offer.exists()) batch.delete(offer.ref);
			}

			batch.update(doc(firestore, "events", invite.eventId), {
				memberIds: arrayUnion(invite.inviteeUid),
				[`roles.${invite.inviteeUid}`]: invite.role,
			});
			batch.update(doc(firestore, INVITES_COLLECTION, invite.id), {
				status: "accepted",
				decidedAt: serverTimestamp(),
			});

			await batch.commit();
		},

		async declineInvite(id: string): Promise<void> {
			await updateDoc(doc(firestore, INVITES_COLLECTION, id), {
				status: "declined",
				decidedAt: serverTimestamp(),
			});
		},

		async updateEventMembership(
			eventId: string,
			membership: { memberIds: string[]; roles: Record<string, EventRole> },
			removedUid?: string,
		): Promise<void> {
			const batch = writeBatch(firestore);
			batch.update(doc(firestore, "events", eventId), membership);

			if (removedUid) {
				// Their own invitation says which address any old offer went to.
				// Gone if they erased it (ADR 0013); then there's nothing to match.
				const record = await getDoc(
					doc(firestore, INVITES_COLLECTION, inviteId(eventId, removedUid)),
				);
				// `inviteeEmail` is optional on an invitation: without one there is
				// no address to match, so nothing to spend.
				const { inviteeEmail, invitedBy } = record.data() ?? {};
				if (
					typeof inviteeEmail === "string" &&
					inviteeEmail &&
					typeof invitedBy === "string"
				) {
					const offer = await emailOfferTo(eventId, invitedBy, inviteeEmail);
					if (offer) batch.delete(offer);
				}
			}

			await batch.commit();
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

			try {
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
			} catch (error) {
				// Both callers swallow this rejection; the record is all that's left.
				record("publishDirectoryEntry", outcomeOf(error), error);
				throw error;
			}
			record("publishDirectoryEntry", "success");
		},
	};
}
