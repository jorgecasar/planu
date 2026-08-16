import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { arrayUnion, doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const STRANGER = "stranger-uid";

const EVENT = "events/an-event";
const INVITE = `eventInvites/an-event_${GUEST}`;

const RULES = readFileSync("../../firestore.rules", "utf8");

/** Same rules, but the owner may no longer add members unilaterally. */
const PATCHED = RULES.replace(
	`(isOwner()
                          && request.resource.data.userId == resource.data.userId)`,
	`(isOwner()
                          && request.resource.data.userId == resource.data.userId
                          && request.resource.data.memberIds
                               .hasOnly(resource.data.memberIds))`,
);

let env: RulesTestEnvironment;
let patched: RulesTestEnvironment;

const anEvent = (extra: Record<string, unknown> = {}) => ({
	title: "Concert",
	description: "Live music",
	location: "Madrid",
	userId: OWNER,
	startDate: null,
	endDate: null,
	imageUrl: "",
	memberIds: [OWNER],
	roles: {},
	...extra,
});

const anInvite = (extra: Record<string, unknown> = {}) => ({
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeUid: GUEST,
	inviteeEmail: "ana@example.com",
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer",
	...extra,
});

beforeAll(async () => {
	if (PATCHED === RULES) throw new Error("patch did not apply");
	env = await initializeTestEnvironment({
		projectId: "planu-probe2",
		firestore: { host: "localhost", port: 8181, rules: RULES },
	});
	patched = await initializeTestEnvironment({
		projectId: "planu-probe2-patched",
		firestore: { host: "localhost", port: 8181, rules: PATCHED },
	});
});

afterAll(async () => {
	await env?.cleanup();
	await patched?.cleanup();
});

beforeEach(async () => {
	for (const e of [env, patched]) {
		await e.clearFirestore();
		await e.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), EVENT), anEvent());
			await setDoc(doc(ctx.firestore(), INVITE), anInvite());
		});
	}
});

const as = (uid: string, e = env) => e.authenticatedContext(uid).firestore();

describe("PROBE E — re-inviting the same person, which is what the UI does", () => {
	test("same everything, only the role changes: allowed", async () => {
		await assertSucceeds(
			setDoc(doc(as(OWNER), INVITE), anInvite({ role: "editor" })),
		);
	});

	test("the owner retyped the address with different capitalisation: refused", async () => {
		// findUserByEmail() lowercases before hashing, so this resolves to the
		// same uid and the same document id — but inviteeEmail is stored as typed.
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ inviteeEmail: "Ana@Example.com", role: "editor" }),
			),
		);
	});

	test("the event was renamed since the first invitation: refused", async () => {
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ eventTitle: "Concert (moved)", role: "editor" }),
			),
		);
	});

	test("the owner set a display name since the first invitation: refused", async () => {
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ invitedByName: "Ana Ruiz", role: "editor" }),
			),
		);
	});
});

describe("PROBE F — pinning the owner branch to removals only", () => {
	test("the owner can no longer conscript a stranger", async () => {
		await assertFails(
			updateDoc(doc(as(OWNER, patched), EVENT), {
				memberIds: [OWNER, STRANGER],
				roles: { [STRANGER]: "editor" },
			}),
		);
	});

	test("accepting an invitation still works", async () => {
		await assertSucceeds(
			updateDoc(doc(as(GUEST, patched), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("the owner can still change a member's role", async () => {
		await updateDoc(doc(as(GUEST, patched), EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		await assertSucceeds(
			updateDoc(doc(as(OWNER, patched), EVENT), {
				memberIds: [OWNER, GUEST],
				roles: { [GUEST]: "editor" },
			}),
		);
	});

	test("the owner can still remove a member", async () => {
		await updateDoc(doc(as(GUEST, patched), EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		await assertSucceeds(
			updateDoc(doc(as(OWNER, patched), EVENT), {
				memberIds: [OWNER],
				roles: {},
			}),
		);
	});

	test("the owner can still edit the content", async () => {
		await assertSucceeds(
			updateDoc(doc(as(OWNER, patched), EVENT), { title: "Another concert" }),
		);
	});

	test("a guest can still leave", async () => {
		await updateDoc(doc(as(GUEST, patched), EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		await assertSucceeds(
			updateDoc(doc(as(GUEST, patched), EVENT), {
				memberIds: [OWNER],
				roles: {},
			}),
		);
	});
});
