import { logger } from "firebase-functions";
import { onUserDeleted } from "firebase-functions/v2/identity";
import { logDeletedUser } from "./log-deleted-user.js";

/**
 * Runs when an Auth account is deleted. For now it only records the uid; the
 * sweep of the data left behind arrives in the following tasks of GH-154.
 */
export const onAccountDeleted = onUserDeleted((event) => {
	logDeletedUser(event.data.uid, (message, data) => {
		logger.info(message, data);
	});
});
