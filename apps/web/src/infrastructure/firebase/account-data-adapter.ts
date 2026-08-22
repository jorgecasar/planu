/**
 * `AccountDataPort` adapter (T32): the one file, along with its test, that
 * knows account deletion touches Firestore and Storage.
 */

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
import type { FirebaseStorage } from "firebase/storage";
import { deleteObject, ref } from "firebase/storage";
import type {
	AccountDataPort,
	AccountEventSummary,
} from "../../application/ports/account-data.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PROFILES_COLLECTION,
} from "../../sharing/user-directory.js";

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

		async deleteEventImage(imageUrl: string): Promise<void> {
			try {
				await deleteObject(ref(storage, imageUrl));
			} catch {
				// Already deleted, or the URL no longer resolves to anything:
				// not a reason to leave the rest of the deletion unfinished. The
				// account gets deleted either way; an orphaned image in Storage
				// isn't reachable without the account that uploaded it, and the
				// rules protect it just the same.
			}
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
	};
}
