import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	collection,
	deleteDoc,
	doc,
	getDocs,
	query,
	setDoc,
	where,
} from "firebase/firestore";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

// GH-193: once an event is gone, its owner is the only one who can sweep what
// was left behind. These tests pin the rules that sweep relies on, with the
// event already deleted: the owner needs no event document to erase their own
// invitations and offers, but must be verified to do it.

const OWNER = "owner-uid";
const EVENT_ID = "gone-event";
const EMAIL = "someone@example.com";
const HASH = createHash("sha256").update(EMAIL).digest("hex");
const OFFER = `eventInvitesByEmail/${EVENT_ID}_${HASH}`;

const STATUSES = ["pending", "accepted", "declined", "removed"] as const;
const inviteePath = (status: string) => `eventInvites/${EVENT_ID}_${status}`;

const anInvite = (status: string) => ({
	eventId: EVENT_ID,
	eventTitle: "Concert",
	inviteeUid: `${status}-uid`,
	inviteeEmail: EMAIL,
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer",
	status,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-owner-cleanup-test",
		firestore: {
			host: "localhost",
			port: 8181,
			rules: readFileSync("../../firestore.rules", "utf8"),
		},
	});
});

afterAll(async () => {
	await env?.cleanup();
});

const seed = (path: string, data: object) =>
	env.withSecurityRulesDisabled((ctx) =>
		setDoc(doc(ctx.firestore(), path), data),
	);

// No event document is ever seeded: the event is already deleted.
beforeEach(async () => {
	await env.clearFirestore();
	for (const status of STATUSES) {
		await seed(inviteePath(status), anInvite(status));
	}
	await seed(OFFER, {
		eventId: EVENT_ID,
		eventTitle: "Concert",
		inviteeEmail: EMAIL,
		invitedBy: OWNER,
		invitedByName: "Ana",
		role: "viewer",
	});
});

const asOwner = (verified: boolean) =>
	env.authenticatedContext(OWNER, { email_verified: verified }).firestore();

describe("owner sweeping the leftovers of a deleted event", () => {
	test.each(STATUSES)(
		"the verified owner deletes a %s invitation",
		async (status) => {
			await assertSucceeds(deleteDoc(doc(asOwner(true), inviteePath(status))));
		},
	);

	test("the verified owner deletes the offer by email", async () => {
		await assertSucceeds(deleteDoc(doc(asOwner(true), OFFER)));
	});

	test.each([...STATUSES.map(inviteePath), OFFER])(
		"the unverified owner cannot delete %s",
		async (path) => {
			await assertFails(deleteDoc(doc(asOwner(false), path)));
		},
	);

	test.each(["eventInvites", "eventInvitesByEmail"])(
		"the verified owner lists %s by invitedBy and eventId",
		async (name) => {
			const db = asOwner(true);
			const snap = await assertSucceeds(
				getDocs(
					query(
						collection(db, name),
						where("invitedBy", "==", OWNER),
						where("eventId", "==", EVENT_ID),
					),
				),
			);
			expect(snap.size).toBe(name === "eventInvites" ? STATUSES.length : 1);
		},
	);
});
