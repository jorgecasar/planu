/**
 * `AccountExportPort` adapter (HU-447): reads what the person can read about
 * themselves with the queries the rules allow; the domain shapes the file.
 */

import type { Firestore } from "firebase/firestore";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	query,
	where,
} from "firebase/firestore";
import type { AccountExportPort } from "../../application/ports/account-export.js";
import type {
	ExportInviteSource,
	PublicCard,
} from "../../domain/account-export.js";
import {
	DIRECTORY_COLLECTION,
	emailHash,
	PENDING_INVITES_BY_EMAIL_COLLECTION,
	PROFILES_COLLECTION,
} from "../firestore-schema/user-directory.js";

type Data = Record<string, unknown> | undefined;

const card = (data: Data): PublicCard | null =>
	data
		? {
				displayName: String(data["displayName"] ?? ""),
				photoURL: String(data["photoURL"] ?? ""),
			}
		: null;

const invite = (id: string, data: Data): ExportInviteSource => ({
	id,
	eventId: String(data?.["eventId"] ?? ""),
	role: String(data?.["role"] ?? ""),
});

export function createAccountExportAdapter(
	firestore: Firestore,
	currentEmail: () => string | null,
): AccountExportPort {
	const listWhere = async (path: string, field: string, value: string) =>
		(
			await getDocs(
				query(collection(firestore, path), where(field, "==", value)),
			)
		).docs;

	return {
		async read(uid) {
			const email = currentEmail();
			const hash = email ? await emailHash(email) : null;
			const offers = PENDING_INVITES_BY_EMAIL_COLLECTION;
			const [profile, directory, events, sent, sentOffers, received, offered] =
				await Promise.all([
					getDoc(doc(firestore, PROFILES_COLLECTION, uid)),
					hash ? getDoc(doc(firestore, DIRECTORY_COLLECTION, hash)) : null,
					getDocs(
						query(
							collection(firestore, "events"),
							where("memberIds", "array-contains", uid),
						),
					),
					listWhere("eventInvites", "invitedBy", uid),
					listWhere(offers, "invitedBy", uid),
					listWhere("eventInvites", "inviteeUid", uid),
					hash ? listWhere(offers, "emailHash", hash) : [],
				]);
			const profileCard = card(profile.data());

			return {
				uid,
				email,
				displayName: profileCard?.displayName ?? null,
				profile: profileCard,
				directoryEntry: card(directory?.data()),
				events: events.docs.map((d) => {
					const data = d.data();
					const isOwner = data["userId"] === uid;
					// Someone else's event is read to count the membership, never kept.
					return { id: d.id, isOwner, fields: isOwner ? data : {} };
				}),
				sentInvites: [...sent, ...sentOffers].map((d) =>
					invite(d.id, d.data()),
				),
				receivedInvites: [...received, ...offered].map((d) =>
					invite(d.id, d.data()),
				),
			};
		},
	};
}
