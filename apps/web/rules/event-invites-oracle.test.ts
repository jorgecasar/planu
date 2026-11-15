import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

// GH-259: characterization, not endorsement. A `get` on `eventInvites/{id}`
// from a third party succeeds when the document is missing and fails when it
// exists, so the answer reveals whether that person has or had an invitation
// (tombstones included). If the oracle is closed, invert these tests.

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const STRANGER = "stranger-uid";
const EXISTING = `eventInvites/an-event_${GUEST}`;
const MISSING = "eventInvites/an-event_nobody-uid";

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-invites-oracle-test",
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
	await env.withSecurityRulesDisabled((ctx) =>
		setDoc(doc(ctx.firestore(), EXISTING), {
			eventId: "an-event",
			inviteeUid: GUEST,
			invitedBy: OWNER,
			status: "removed",
		}),
	);
});

const asStranger = (verified: boolean) =>
	env.authenticatedContext(STRANGER, { email_verified: verified }).firestore();

describe("existence oracle on eventInvites", () => {
	test.each([true, false])(
		"a third party reads a missing id (verified: %s)",
		async (verified) => {
			await assertSucceeds(getDoc(doc(asStranger(verified), MISSING)));
		},
	);

	test.each([true, false])(
		"a third party is denied an existing id (verified: %s)",
		async (verified) => {
			await assertFails(getDoc(doc(asStranger(verified), EXISTING)));
		},
	);

	test("without a session, neither answer is given", async () => {
		const anon = env.unauthenticatedContext().firestore();
		await assertFails(getDoc(doc(anon, MISSING)));
		await assertFails(getDoc(doc(anon, EXISTING)));
	});
});
