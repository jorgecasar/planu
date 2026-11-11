/**
 * `AccountDataPort` adapter (T32): the one file, along with its test, that
 * knows account deletion touches Firestore and Storage.
 */

import { FirebaseError } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import {
	collection,
	deleteDoc,
	doc,
	getDocs,
	query,
	updateDoc,
	where,
} from "firebase/firestore";
import type { FirebaseStorage, StorageReference } from "firebase/storage";
import { deleteObject, listAll, ref } from "firebase/storage";
import type {
	AccountDataPort,
	AccountEventSummary,
} from "../../application/ports/account-data.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PENDING_INVITES_BY_EMAIL_COLLECTION,
	PROFILES_COLLECTION,
} from "../../sharing/user-directory.js";

// One query per field: the read rule matches list queries against their
// constraints, and only `inviteeUid ==` or `invitedBy ==` pass.
async function deleteInvitesWhere(
	firestore: Firestore,
	field: "inviteeUid" | "invitedBy",
	uid: string,
	path = "eventInvites",
): Promise<void> {
	const snapshot = await getDocs(
		query(collection(firestore, path), where(field, "==", uid)),
	);
	await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)));
}

export function createAccountDataAdapter(
	firestore: Firestore,
	storage: FirebaseStorage,
): AccountDataPort {
	return {
		async listMemberEvents(uid: string): Promise<AccountEventSummary[]> {
			// `memberIds array-contains`, not `userId ==`: same reason as
			// `events-view.ts` — the rules deny any other way of querying
			// `events`.
			const snapshot = await getDocs(
				query(
					collection(firestore, "events"),
					where("memberIds", "array-contains", uid),
				),
			);

			return snapshot.docs.map((document) => {
				const data = document.data();
				const isOwner = data["userId"] === uid;
				const imageUrl =
					isOwner && typeof data["imageUrl"] === "string" && data["imageUrl"]
						? data["imageUrl"]
						: undefined;
				return { id: document.id, isOwner, ...(imageUrl && { imageUrl }) };
			});
		},

		async deleteOwnEvent(eventId: string): Promise<void> {
			await deleteDoc(doc(firestore, "events", eventId));
		},

		async leaveEvent(eventId: string, uid: string): Promise<void> {
			// Reads before writing: `leavesTheEvent()` in the rules requires
			// `memberIds`/`roles` to result from removing exactly this uid from
			// the current document, not from a value computed blind without
			// having read the real state.
			const snapshot = await getDocs(
				query(
					collection(firestore, "events"),
					where("memberIds", "array-contains", uid),
				),
			);
			const found = snapshot.docs.find((d) => d.id === eventId);
			// No longer a member — the account already left, or the event no
			// longer exists —: nothing to do, and not an error. This is exactly
			// what makes a retry after a mid-flight interruption resumable.
			if (!found) return;

			const data = found.data();
			const memberIds = (data["memberIds"] as string[]).filter(
				(id) => id !== uid,
			);
			const roles = { ...(data["roles"] as Record<string, string>) };
			delete roles[uid];

			await updateDoc(doc(firestore, "events", eventId), {
				memberIds,
				roles,
			});
		},

		async deleteEventImage(imageUrl: string, uid: string): Promise<void> {
			// Only the account's own prefix in this app's bucket. An editor's
			// cover on an owned event lives under the editor's uid, which the
			// rules won't let this account delete: failing on it would let any
			// editor block the owner's deletion for good. A URL that doesn't
			// parse points at nothing this account can delete either.
			let target: StorageReference;
			try {
				target = ref(storage, imageUrl);
			} catch {
				return;
			}
			// Only names the app itself creates under `events/{uid}/`: `ref()`
			// doesn't normalise, so `..`, subfolders or an encoded `/` would
			// pass a looser check and still be denied. Anything skipped here is
			// still swept by `deleteAllEventImages(uid)`.
			const prefix = `events/${uid}/`;
			const name = target.fullPath.slice(prefix.length);
			if (
				target.bucket !== ref(storage).bucket ||
				!target.fullPath.startsWith(prefix) ||
				// Allowed shape comes from `uploadFile()` in `firebase/storage.ts`.
				!/^[A-Za-z0-9._-]+$/.test(name) ||
				name === "." ||
				name === ".." ||
				// Production's 1024-byte name cap; ASCII-only here, so chars = bytes.
				target.fullPath.length > 1024
			) {
				return;
			}

			try {
				await deleteObject(target);
			} catch (cause) {
				// Already deleted: not a reason to leave the rest of the deletion
				// unfinished, and what makes a retry resumable. Anything else —
				// denied, network — propagates, so the Auth account survives for
				// a retry instead of leaving the image orphaned (#154).
				if (
					cause instanceof FirebaseError &&
					cause.code === "storage/object-not-found"
				) {
					return;
				}
				throw cause;
			}
		},

		async deleteAllEventImages(uid: string): Promise<void> {
			// One level is enough: `storage.rules` only matches
			// `events/{userId}/{fileName}`, so nothing can live deeper.
			const { items } = await listAll(ref(storage, `events/${uid}`));
			await Promise.all(items.map((item) => deleteObject(item)));
		},

		async deleteDirectoryEntries(
			uid: string,
			email: string | null,
		): Promise<void> {
			const deletions = [deleteDoc(doc(firestore, PROFILES_COLLECTION, uid))];
			if (email) {
				deletions.push(
					deleteDoc(
						doc(firestore, DIRECTORY_COLLECTION, await emailHash(email)),
					),
				);
			}
			await Promise.all(deletions);
		},

		deleteReceivedInvitations(uid: string): Promise<void> {
			return deleteInvitesWhere(firestore, "inviteeUid", uid);
		},

		async deleteSentInvitations(uid: string): Promise<void> {
			// No expiry for unclaimed offers yet (open decision); this is all
			// that erases them.
			await Promise.all([
				deleteInvitesWhere(firestore, "invitedBy", uid),
				deleteInvitesWhere(
					firestore,
					"invitedBy",
					uid,
					PENDING_INVITES_BY_EMAIL_COLLECTION,
				),
			]);
		},
	};
}
