/**
 * Region every Cloud Function of this workspace is deployed to.
 *
 * The repo does not record where the Firestore database `planu` and the Storage
 * bucket live, so this is europe-west1 (Belgium) on purpose: it keeps the
 * processing of personal data inside the EU (GDPR) and close to Firebase
 * services, instead of the implicit us-central1 default. OWNER DECISION: if the
 * database is elsewhere, change it here. Changing the region of a deployed
 * function creates a new function, so review the first deploy by hand.
 */
export const FUNCTIONS_REGION = "europe-west1";
