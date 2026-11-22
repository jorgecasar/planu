import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onUserDeleted } from "firebase-functions/v2/identity";
import { logDeletedUser } from "./log-deleted-user.js";
import { sweepDirectory } from "./sweep-directory.js";
import { sweepOwnedData } from "./sweep-owned-data.js";
import { sweepReferences } from "./sweep-references.js";

const app = getApps().length > 0 ? getApp() : initializeApp();

/**
 * Runs when an Auth account is deleted: records the uid, sweeps the events and
 * images that account owned, then what it left in other people's data (its
 * membership, invitations and email offers), then its profile and directory
 * entries.
 *
 * `retry` is on: a sweep that throws is run again, and every step is
 * idempotent, so a failure halfway does not leave data behind for good.
 */
export const onAccountDeleted = onUserDeleted(
	{ retry: true },
	async (event) => {
		const { uid } = event.data;
		logDeletedUser(uid, (message, data) => {
			logger.info(message, data);
		});
		// The database is called `planu`, not `(default)`.
		const firestore = getFirestore(app, "planu");
		await sweepOwnedData(uid, { firestore, bucket: getStorage(app).bucket() });
		await sweepReferences(uid, { firestore });
		await sweepDirectory(uid, { firestore });
	},
);
