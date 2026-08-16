import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	arrayUnion,
	deleteDoc,
	doc,
	setDoc,
	updateDoc,
	writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const STRANGER = "stranger-uid";

const EVENT = "events/an-event";
const INVITE = `eventInvites/an-event_${GUEST}`;

const RULES = readFileSync("../../firestore.rules", "utf8");

/** Same rules, but the accept branch demands the invitation be consumed. */
const PATCHED = RULES.replace(
	"&& exists(invitePath())",
	"&& exists(invitePath())\n            && !existsAfter(invitePath())\n            && get(invitePath()).data.inviteeUid == uid()\n            && get(invitePath()).data.eventId == eventId",
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
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer",
	...extra,
});

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-probe-test",
		firestore: { host: "localhost", port: 8181, rules: RULES },
	});
	patched = await initializeTestEnvironment({
		projectId: "planu-probe-patched",
		firestore: { host: "localhost", port: 8181, rules: PATCHED },
	});
});

afterAll(async () => {
	await env?.cleanup();
	await patched?.cleanup();
});

beforeEach(async () => {
	await env.clearFirestore();
	await patched.clearFirestore();
	for (const e of [env, patched]) {
		await e.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), EVENT), anEvent());
			await setDoc(doc(ctx.firestore(), INVITE), anInvite());
		});
	}
});

const as = (uid: string, e = env) => e.authenticatedContext(uid).firestore();

describe("PROBE A — the owner bypasses the consent gate entirely", () => {
	test("the owner pushes a stranger into the event with no invitation at all", async () => {
		await assertSucceeds(
			updateDoc(doc(as(OWNER), EVENT), {
				memberIds: [OWNER, STRANGER],
				roles: { [STRANGER]: "editor" },
			}),
		);
	});

	test("and can do it again right after the victim leaves", async () => {
		await updateDoc(doc(as(OWNER), EVENT), {
			memberIds: [OWNER, STRANGER],
			roles: { [STRANGER]: "viewer" },
		});
		await assertSucceeds(
			updateDoc(doc(as(STRANGER), EVENT), {
				memberIds: [OWNER],
				roles: {},
			}),
		);
		await assertSucceeds(
			updateDoc(doc(as(OWNER), EVENT), {
				memberIds: [OWNER, STRANGER],
				roles: { [STRANGER]: "viewer" },
			}),
		);
	});
});

describe("PROBE B — the invitation is never required to be consumed", () => {
	test("a guest joins without deleting the invitation, is expelled, and walks back in", async () => {
		// 1. Join, keeping the ticket.
		await assertSucceeds(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);

		// 2. The owner throws them out.
		await assertSucceeds(
			updateDoc(doc(as(OWNER), EVENT), { memberIds: [OWNER], roles: {} }),
		);

		// 3. The stale invitation is still a valid key.
		await assertSucceeds(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});
});

describe("PROBE C — the invite id is parsed, not verified", () => {
	test("an invitation to an event you own opens a different event whose id contains '_'", async () => {
		const ATTACKER = "attacker-uid";
		await env.withSecurityRulesDisabled(async (ctx) => {
			// The victim's event. Its id merely contains an underscore.
			await setDoc(doc(ctx.firestore(), "events/abc_d"), {
				...anEvent(),
				userId: "victim-uid",
				memberIds: ["victim-uid"],
			});
		});

		// The attacker owns an unrelated event called "abc".
		await assertSucceeds(
			setDoc(doc(as(ATTACKER), "events/abc"), {
				...anEvent(),
				userId: ATTACKER,
				memberIds: [ATTACKER],
			}),
		);

		// A perfectly valid invitation to their OWN event "abc"...
		await assertSucceeds(
			setDoc(doc(as(ATTACKER), `eventInvites/abc_d_${ATTACKER}`), {
				eventId: "abc",
				eventTitle: "Mine",
				inviteeUid: `d_${ATTACKER}`,
				invitedBy: ATTACKER,
				invitedByName: "Mallory",
				role: "editor",
			}),
		);

		// ...whose id is also the accept path for the victim's event "abc_d".
		await assertSucceeds(
			updateDoc(doc(as(ATTACKER), "events/abc_d"), {
				memberIds: arrayUnion(ATTACKER),
				[`roles.${ATTACKER}`]: "editor",
			}),
		);
	});
});

describe("PROBE D — the proposed accept rule", () => {
	test("the batch the client actually writes still succeeds", async () => {
		const db = as(GUEST, patched);
		const batch = writeBatch(db);
		batch.update(doc(db, EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		batch.delete(doc(db, INVITE));
		await assertSucceeds(batch.commit());
	});

	test("joining while keeping the invitation is refused", async () => {
		await assertFails(
			updateDoc(doc(as(GUEST, patched), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("the id-parsing route is closed", async () => {
		const ATTACKER = "attacker-uid";
		await patched.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), "events/abc_d"), {
				...anEvent(),
				userId: "victim-uid",
				memberIds: ["victim-uid"],
			});
		});
		await setDoc(doc(as(ATTACKER, patched), "events/abc"), {
			...anEvent(),
			userId: ATTACKER,
			memberIds: [ATTACKER],
		});
		await setDoc(doc(as(ATTACKER, patched), `eventInvites/abc_d_${ATTACKER}`), {
			eventId: "abc",
			eventTitle: "Mine",
			inviteeUid: `d_${ATTACKER}`,
			invitedBy: ATTACKER,
			invitedByName: "Mallory",
			role: "editor",
		});
		await assertFails(
			updateDoc(doc(as(ATTACKER, patched), "events/abc_d"), {
				memberIds: arrayUnion(ATTACKER),
				[`roles.${ATTACKER}`]: "editor",
			}),
		);
	});

	test("declining still works", async () => {
		await assertSucceeds(deleteDoc(doc(as(GUEST, patched), INVITE)));
	});
});
