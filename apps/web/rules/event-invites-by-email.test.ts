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
	getDoc,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const OWNER = "owner";
const STRANGER = "stranger";
const EMAIL = "newcomer@example.com";

const hash = (email: string) =>
	createHash("sha256").update(email.toLowerCase()).digest("hex");
const pathOf = (email = EMAIL, eventId = "an-event") =>
	`eventInvitesByEmail/${eventId}_${hash(email)}`;
const SEEDED_EMAIL = "seeded@example.com";
const SEEDED = pathOf(SEEDED_EMAIL);

const anOffer = (extra: Record<string, unknown> = {}) => ({
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeEmail: EMAIL,
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer",
	createdAt: serverTimestamp(),
	...extra,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-invites-by-email-test",
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

beforeEach(async () => {
	await env.clearFirestore();
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.firestore();
		await setDoc(doc(db, SEEDED), anOffer({ inviteeEmail: SEEDED_EMAIL }));
	});
});

const as = (uid: string, email_verified = true) =>
	env.authenticatedContext(uid, { email_verified }).firestore();

describe("the sender's side of an offer", () => {
	const own = (db: ReturnType<typeof as>) =>
		getDocs(
			query(
				collection(db, "eventInvitesByEmail"),
				where("invitedBy", "==", OWNER),
			),
		);

	test("its verified sender reads, lists and withdraws it", async () => {
		await assertSucceeds(getDoc(doc(as(OWNER), SEEDED)));
		await assertSucceeds(own(as(OWNER)));
		await assertSucceeds(deleteDoc(doc(as(OWNER), SEEDED)));
	});

	test("an unverified sender cannot", async () => {
		await assertFails(getDoc(doc(as(OWNER, false), SEEDED)));
		await assertFails(own(as(OWNER, false)));
		await assertFails(deleteDoc(doc(as(OWNER, false), SEEDED)));
	});

	test("nobody else reads, lists or deletes it", async () => {
		await assertFails(getDoc(doc(as(STRANGER), SEEDED)));
		await assertFails(own(as(STRANGER)));
		await assertFails(getDocs(collection(as(OWNER), "eventInvitesByEmail")));
		await assertFails(deleteDoc(doc(as(STRANGER), SEEDED)));
	});
});
