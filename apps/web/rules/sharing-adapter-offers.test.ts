import { readFileSync } from "node:fs";
import {
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, type Firestore, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createSharingAdapter } from "../src/infrastructure/firebase/sharing-adapter.js";

// The real adapter against the real rules (GH-147). Its unit tests mock the
// SDK, so they can't tell whether the offer lookup it runs before a uid
// invite or a removal is one the rules allow. With no offer to spend — the
// usual case — a lookup they refuse makes both writes fail.

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const EVENT = "events/an-event";
const INVITE = `eventInvites/an-event_${GUEST}`;
const AN_INVITE = {
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeEmail: "guest@example.com",
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer" as const,
	inviteeUid: GUEST,
};

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-sharing-adapter-test",
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
		setDoc(doc(ctx.firestore(), EVENT), {
			title: "Concert",
			description: "",
			location: "",
			userId: OWNER,
			startDate: null,
			endDate: null,
			imageUrl: "",
			memberIds: [OWNER],
			roles: {},
		}),
	);
});

const ownersAdapter = () =>
	createSharingAdapter(
		env
			.authenticatedContext(OWNER, { email_verified: true })
			.firestore() as unknown as Firestore,
	);

async function stored(path: string) {
	let data: Record<string, unknown> | undefined;
	await env.withSecurityRulesDisabled(async (ctx) => {
		data = (await getDoc(doc(ctx.firestore(), path))).data();
	});
	return data;
}

test("a uid invite with no email offer to spend goes through", async () => {
	await ownersAdapter().inviteToEvent(AN_INVITE);

	expect(await stored(INVITE)).toMatchObject({ status: "pending" });
});

test("removing a guest with no email offer to spend goes through", async () => {
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.firestore();
		const joined = { memberIds: [OWNER, GUEST], roles: { [GUEST]: "viewer" } };
		await setDoc(doc(db, EVENT), joined, { merge: true });
		await setDoc(doc(db, INVITE), { ...AN_INVITE, status: "accepted" });
	});

	const membership = { memberIds: [OWNER], roles: {} };
	await ownersAdapter().updateEventMembership("an-event", membership, GUEST);

	expect(await stored(EVENT)).toMatchObject(membership);
});
