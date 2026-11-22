import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sweepOwnedData } from "./sweep-owned-data.js";

// Runs against the Firestore and Storage emulators: `npm run test:emulators`.
const app = initializeApp(
	{ projectId: "planu-app", storageBucket: "planu-app.firebasestorage.app" },
	"sweep-owned-data-test",
);
const firestore = getFirestore(app, "planu");
const bucket = getStorage(app).bucket();

const GONE = "gone-user";
const STAYS = "other-user";

async function seed(uid: string): Promise<void> {
	await firestore
		.collection("events")
		.doc(`${uid}-event`)
		.set({ userId: uid, title: "An event" });
	await bucket.file(`events/${uid}/cover.png`).save("png");
}

async function eventsOf(uid: string): Promise<number> {
	const found = await firestore
		.collection("events")
		.where("userId", "==", uid)
		.get();
	return found.size;
}

async function imagesOf(uid: string): Promise<number> {
	const [files] = await bucket.getFiles({ prefix: `events/${uid}/` });
	return files.length;
}

describe("sweepOwnedData", () => {
	beforeEach(async () => {
		await sweepOwnedData(GONE, { firestore, bucket });
		await sweepOwnedData(STAYS, { firestore, bucket });
		await seed(GONE);
		await seed(STAYS);
	});

	afterAll(async () => {
		await deleteApp(app);
	});

	it("deletes the events and the images of the deleted account", async () => {
		await sweepOwnedData(GONE, { firestore, bucket });

		expect(await eventsOf(GONE)).toBe(0);
		expect(await imagesOf(GONE)).toBe(0);
	});

	it("leaves the data of every other account alone", async () => {
		await sweepOwnedData(GONE, { firestore, bucket });

		expect(await eventsOf(STAYS)).toBe(1);
		expect(await imagesOf(STAYS)).toBe(1);
	});

	it("catches what was written after an earlier listing", async () => {
		await sweepOwnedData(GONE, { firestore, bucket });
		await seed(GONE);

		await sweepOwnedData(GONE, { firestore, bucket });

		expect(await eventsOf(GONE)).toBe(0);
		expect(await imagesOf(GONE)).toBe(0);
	});

	it("is idempotent: a second run on a clean account does not fail", async () => {
		await sweepOwnedData(GONE, { firestore, bucket });

		await expect(
			sweepOwnedData(GONE, { firestore, bucket }),
		).resolves.toBeUndefined();
	});

	it("does not sweep the account whose uid is the prefix of another", async () => {
		await bucket.file(`events/${GONE}-2/cover.png`).save("png");

		await sweepOwnedData(GONE, { firestore, bucket });

		expect(await imagesOf(`${GONE}-2`)).toBe(1);
		await bucket.deleteFiles({ prefix: `events/${GONE}-2/` });
	});

	it("refuses a uid that is empty or has a slash in it", async () => {
		await expect(sweepOwnedData("", { firestore, bucket })).rejects.toThrow(
			/uid/,
		);
		await expect(sweepOwnedData("a/b", { firestore, bucket })).rejects.toThrow(
			/uid/,
		);
	});
});
