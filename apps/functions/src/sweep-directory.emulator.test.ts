import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sweepDirectory } from "./sweep-directory.js";

// Runs against the Firestore emulator: `npm run test:emulators`.
const app = initializeApp({ projectId: "planu-app" }, "sweep-directory-test");
const firestore = getFirestore(app, "planu");

const GONE = "gone-user";
const OTHER = "other-user";
const COLLECTIONS = ["userProfiles", "userDirectory"];

const exists = async (path: string) => (await firestore.doc(path).get()).exists;

describe("sweepDirectory", () => {
	beforeEach(async () => {
		for (const name of COLLECTIONS) {
			await firestore.recursiveDelete(firestore.collection(name));
		}
	});

	afterAll(async () => {
		await deleteApp(app);
	});

	it("deletes the profile of the account and no other", async () => {
		await firestore.doc(`userProfiles/${GONE}`).set({ displayName: "Gone" });
		await firestore.doc(`userProfiles/${OTHER}`).set({ displayName: "Other" });

		await sweepDirectory(GONE, { firestore });

		expect(await exists(`userProfiles/${GONE}`)).toBe(false);
		expect(await exists(`userProfiles/${OTHER}`)).toBe(true);
	});

	it("deletes every directory entry of the account, whatever its email", async () => {
		await firestore.doc("userDirectory/hash-old").set({ uid: GONE });
		await firestore.doc("userDirectory/hash-new").set({ uid: GONE });
		await firestore.doc("userDirectory/hash-other").set({ uid: OTHER });

		await sweepDirectory(GONE, { firestore });

		expect(await exists("userDirectory/hash-old")).toBe(false);
		expect(await exists("userDirectory/hash-new")).toBe(false);
		expect(await exists("userDirectory/hash-other")).toBe(true);
	});

	it("is idempotent: a second run on a clean account does not fail", async () => {
		await sweepDirectory(GONE, { firestore });

		await expect(sweepDirectory(GONE, { firestore })).resolves.toBeUndefined();
	});

	it("refuses a uid that is empty or has a slash in it", async () => {
		await expect(sweepDirectory("", { firestore })).rejects.toThrow(/uid/);
		await expect(sweepDirectory("a/b", { firestore })).rejects.toThrow(/uid/);
	});
});
