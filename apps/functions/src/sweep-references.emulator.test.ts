import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sweepReferences } from "./sweep-references.js";

// Runs against the Firestore emulator: `npm run test:emulators`.
const app = initializeApp({ projectId: "planu-app" }, "sweep-references-test");
const firestore = getFirestore(app, "planu");

const GONE = "gone-user";
const OWNER = "owner-user";
const OTHER = "other-user";
const COLLECTIONS = ["events", "eventInvites", "eventInvitesByEmail"];

const exists = async (path: string) => (await firestore.doc(path).get()).exists;

describe("sweepReferences", () => {
	beforeEach(async () => {
		for (const name of COLLECTIONS) {
			await firestore.recursiveDelete(firestore.collection(name));
		}
	});

	afterAll(async () => {
		await deleteApp(app);
	});

	it("takes the account out of the events of other people", async () => {
		await firestore.doc("events/shared").set({
			userId: OWNER,
			memberIds: [OWNER, GONE, OTHER],
			roles: { [OWNER]: "owner", [GONE]: "editor", [OTHER]: "reader" },
		});
		await firestore
			.doc("events/not-a-member")
			.set({ userId: OWNER, memberIds: [OWNER], roles: { [OWNER]: "owner" } });

		await sweepReferences(GONE, { firestore });

		const shared = (await firestore.doc("events/shared").get()).data();
		expect(shared?.["memberIds"]).toEqual([OWNER, OTHER]);
		expect(shared?.["roles"]).toEqual({ [OWNER]: "owner", [OTHER]: "reader" });
		expect((await firestore.doc("events/not-a-member").get()).data()).toEqual({
			userId: OWNER,
			memberIds: [OWNER],
			roles: { [OWNER]: "owner" },
		});
	});

	it("deletes the invitations the account received and sent", async () => {
		await firestore
			.doc("eventInvites/received")
			.set({ inviteeUid: GONE, invitedBy: OWNER, status: "pending" });
		await firestore
			.doc("eventInvites/sent")
			.set({ inviteeUid: OTHER, invitedBy: GONE, status: "pending" });
		await firestore
			.doc("eventInvites/unrelated")
			.set({ inviteeUid: OTHER, invitedBy: OWNER, status: "pending" });

		await sweepReferences(GONE, { firestore });

		expect(await exists("eventInvites/received")).toBe(false);
		expect(await exists("eventInvites/sent")).toBe(false);
		expect(await exists("eventInvites/unrelated")).toBe(true);
	});

	it("leaves the tombstones that name the account, pending a decision", async () => {
		await firestore
			.doc("eventInvites/tombstone")
			.set({ inviteeUid: GONE, invitedBy: OWNER, status: "removed" });

		await sweepReferences(GONE, { firestore });

		expect(await exists("eventInvites/tombstone")).toBe(true);
	});

	it("deletes the email offers the account made", async () => {
		await firestore
			.doc("eventInvitesByEmail/mine")
			.set({ invitedBy: GONE, emailHash: "hash-a" });
		await firestore
			.doc("eventInvitesByEmail/theirs")
			.set({ invitedBy: OWNER, emailHash: "hash-b" });

		await sweepReferences(GONE, { firestore });

		expect(await exists("eventInvitesByEmail/mine")).toBe(false);
		expect(await exists("eventInvitesByEmail/theirs")).toBe(true);
	});

	it("is idempotent: a second run on a clean account does not fail", async () => {
		await sweepReferences(GONE, { firestore });

		await expect(sweepReferences(GONE, { firestore })).resolves.toBeUndefined();
	});

	it("refuses a uid that is empty or has a slash in it", async () => {
		await expect(sweepReferences("", { firestore })).rejects.toThrow(/uid/);
		await expect(sweepReferences("a/b", { firestore })).rejects.toThrow(/uid/);
	});
});
