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
	Timestamp,
	updateDoc,
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

// `undefined` drops a field, to test the ones that are required.
const anOffer = (extra: Record<string, unknown> = {}) =>
	Object.fromEntries(
		Object.entries({
			eventId: "an-event",
			eventTitle: "Concert",
			inviteeEmail: EMAIL,
			invitedBy: OWNER,
			invitedByName: "Ana",
			role: "viewer",
			createdAt: serverTimestamp(),
			...extra,
		}).filter(([, v]) => v !== undefined),
	);

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
		await setDoc(doc(db, "events/an-event"), { userId: OWNER });
		await setDoc(doc(db, "events/theirs"), { userId: STRANGER });
		await setDoc(doc(db, SEEDED), anOffer({ inviteeEmail: SEEDED_EMAIL }));
	});
});

const as = (uid: string, email_verified = true) =>
	env.authenticatedContext(uid, { email_verified }).firestore();
const offer = (db = as(OWNER), extra = {}, path = pathOf()) =>
	setDoc(doc(db, path), anOffer(extra));

describe("offering an event to an email", () => {
	test("the verified owner offers their own event, case-insensitively", async () => {
		await assertSucceeds(offer());
		const upper = { inviteeEmail: "Up@Example.com" };
		await assertSucceeds(offer(as(OWNER), upper, pathOf("up@example.com")));
		const unnamed = { inviteeEmail: "b@example.com", invitedByName: undefined };
		await assertSucceeds(offer(as(OWNER), unnamed, pathOf("b@example.com")));
	});

	test("only the verified owner, on their own event, in their own name", async () => {
		await assertFails(offer(as(OWNER, false)));
		await assertFails(offer(as(STRANGER), { invitedBy: STRANGER }));
		await assertFails(offer(as(OWNER), { invitedBy: STRANGER }));
		const theirs = { eventId: "theirs" };
		await assertFails(offer(as(OWNER), theirs, pathOf(EMAIL, "theirs")));
		const gone = { eventId: "gone" };
		await assertFails(offer(as(OWNER), gone, pathOf(EMAIL, "gone")));
	});

	test("the id is the event plus the hash of the stored address", async () => {
		await assertFails(offer(as(OWNER), {}, pathOf("someone@example.com")));
		await assertFails(offer(as(OWNER), {}, pathOf(EMAIL, "theirs")));
	});

	test.each([
		["a client-set date", { createdAt: Timestamp.fromMillis(0) }],
		["an unknown field", { filler: "x" }],
		["an unknown role", { role: "owner" }],
		["no title", { eventTitle: undefined }],
		["no role", { role: undefined }],
		["no date", { createdAt: undefined }],
		["an over-long title", { eventTitle: "x".repeat(201) }],
		["an over-long inviter name", { invitedByName: "x".repeat(201) }],
		["a non-string inviter name", { invitedByName: 1 }],
	])("rejects %s", async (_name, extra) => {
		await assertFails(offer(as(OWNER), extra));
	});

	test("rejects an over-long address", async () => {
		const long = `${"x".repeat(310)}@example.com`;
		await assertFails(offer(as(OWNER), { inviteeEmail: long }, pathOf(long)));
	});

	test("rejects an over-long event id, even on an owned event", async () => {
		const eventId = "x".repeat(129);
		await env.withSecurityRulesDisabled((ctx) =>
			setDoc(doc(ctx.firestore(), `events/${eventId}`), { userId: OWNER }),
		);
		await assertFails(offer(as(OWNER), { eventId }, pathOf(EMAIL, eventId)));
	});

	test("nobody updates an offer, not even its sender", async () => {
		await assertFails(updateDoc(doc(as(OWNER), SEEDED), { role: "editor" }));
		const again = { inviteeEmail: SEEDED_EMAIL };
		await assertFails(offer(as(OWNER), again, SEEDED));
	});
});

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
