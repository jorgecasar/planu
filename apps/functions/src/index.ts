import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onUserDeleted } from "firebase-functions/v2/identity";
import { logDeletedUser } from "./log-deleted-user.js";
import { sweepDirectory } from "./sweep-directory.js";
import { sweepOwnedData } from "./sweep-owned-data.js";

const app = getApps().length > 0 ? getApp() : initializeApp();

/**
 * Runs when an Auth account is deleted: records the uid, sweeps the events and
 * images that account owned, then its profile and directory entries.
 */
export const onAccountDeleted = onUserDeleted(async (event) => {
	const { uid } = event.data;
	logDeletedUser(uid, (message, data) => {
		logger.info(message, data);
	});
	// The database is called `planu`, not `(default)`.
	const firestore = getFirestore(app, "planu");
	await sweepOwnedData(uid, { firestore, bucket: getStorage(app).bucket() });
	await sweepDirectory(uid, { firestore });
});
