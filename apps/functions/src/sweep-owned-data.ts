import type { Firestore } from "firebase-admin/firestore";

/** The one thing the sweep needs from a Storage bucket. */
export interface SweepBucket {
	deleteFiles(options: { prefix: string; force: boolean }): Promise<unknown>;
}

export interface SweepDeps {
	readonly firestore: Firestore;
	readonly bucket: SweepBucket;
}

/**
 * Deletes what a deleted account left behind that it owned: its events and
 * everything under `events/{uid}/` in Storage. It reads at the moment it runs,
 * so what was written after the client listed its data is swept too, and a
 * second run on a clean account finds nothing and does nothing.
 */
export async function sweepOwnedData(
	uid: string,
	{ firestore, bucket }: SweepDeps,
): Promise<void> {
	// An empty uid would match nothing useful; a slash would widen the prefix.
	if (uid.length === 0 || uid.includes("/")) {
		throw new Error("sweepOwnedData needs the uid of the deleted account");
	}

	// Only by the verified uid, never by another field.
	const owned = await firestore
		.collection("events")
		.where("userId", "==", uid)
		.get();
	const writer = firestore.bulkWriter();
	// Each delete settles on its own; a failed one must fail the sweep, so the
	// trigger is retried instead of reporting success with data left behind.
	const deletions = Promise.all(
		owned.docs.map((event) => writer.delete(event.ref)),
	);
	await writer.close();
	await deletions;

	// The trailing slash keeps `events/ab/` out of the sweep of `events/a/`.
	await bucket.deleteFiles({ prefix: `events/${uid}/`, force: true });
}
