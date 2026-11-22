import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onUserDeleted } from "firebase-functions/v2/identity";
import { logDeletedUser } from "./log-deleted-user.js";
import { sweepOwnedData } from "./sweep-owned-data.js";

const app = getApps().length > 0 ? getApp() : initializeApp();

/**
 * Runs when an Auth account is deleted: records the uid and sweeps the events
 * and images that account owned. Memberships, invitations and the profile
 * arrive in the following tasks of GH-154.
 */
export const onAccountDeleted = onUserDeleted(async (event) => {
	const { uid } = event.data;
	logDeletedUser(uid, (message, data) => {
		logger.info(message, data);
	});
	await sweepOwnedData(uid, {
		// The database is called `planu`, not `(default)`.
		firestore: getFirestore(app, "planu"),
		bucket: getStorage(app).bucket(),
	});
});
