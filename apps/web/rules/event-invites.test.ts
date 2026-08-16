import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	arrayUnion,
	collection,
	deleteDoc,
	doc,
	getDocs,
	query,
	setDoc,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const STRANGER = "stranger-uid";

const EVENT = "events/an-event";
const INVITE = `eventInvites/an-event_${GUEST}`;

let env: RulesTestEnvironment;

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
		projectId: "planu-invites-test",
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
		await setDoc(doc(ctx.firestore(), EVENT), anEvent());
	});
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

/** Seeds a pending invitation, bypassing the rules. */
const seedInvite = async (extra: Record<string, unknown> = {}) => {
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(doc(ctx.firestore(), INVITE), anInvite(extra));
	});
};

describe("creating an invitation", () => {
	test("the owner invites someone to their own event", async () => {
		await assertSucceeds(setDoc(doc(as(OWNER), INVITE), anInvite()));
	});

	test("a stranger cannot invite anyone to an event that is not theirs", async () => {
		// The whole point: without this, an invitation is just a document anyone
		// can write, and the consent gate means nothing.
		await assertFails(
			setDoc(doc(as(STRANGER), `eventInvites/an-event_${STRANGER}`), {
				...anInvite(),
				inviteeUid: STRANGER,
				invitedBy: STRANGER,
			}),
		);
	});

	test("nobody can forge an invitation on someone else's behalf", async () => {
		await assertFails(
			setDoc(doc(as(GUEST), INVITE), anInvite({ invitedBy: OWNER })),
		);
	});

	test("the document id has to match the event and the invitee", async () => {
		// The accept rule looks the invitation up by that exact id, so a mismatched
		// one would be unusable at best and confusing at worst.
		await assertFails(
			setDoc(doc(as(OWNER), "eventInvites/wrong-id"), anInvite()),
		);
	});

	test("rejects a made-up role", async () => {
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ role: "admin" })),
		);
	});

	test("rejects filler fields", async () => {
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ junk: "x".repeat(100 * 1024) }),
			),
		);
	});

	test("the owner cannot invite themselves", async () => {
		await assertFails(
			setDoc(doc(as(OWNER), `eventInvites/an-event_${OWNER}`), {
				...anInvite(),
				inviteeUid: OWNER,
			}),
		);
	});
});

describe("seeing your invitations", () => {
	test("the invitee lists their own", async () => {
		await seedInvite();
		await assertSucceeds(
			getDocs(
				query(
					collection(as(GUEST), "eventInvites"),
					where("inviteeUid", "==", GUEST),
				),
			),
		);
	});

	test("nobody lists someone else's", async () => {
		await seedInvite();
		await assertFails(
			getDocs(
				query(
					collection(as(STRANGER), "eventInvites"),
					where("inviteeUid", "==", GUEST),
				),
			),
		);
	});

	test("the whole collection cannot be listed", async () => {
		await seedInvite();
		await assertFails(getDocs(collection(as(GUEST), "eventInvites")));
	});
});

describe("accepting an invitation", () => {
	/** What the client writes: no read of the event needed. */
	const accept = (uid: string, role = "viewer") =>
		updateDoc(doc(as(uid), EVENT), {
			memberIds: arrayUnion(uid),
			[`roles.${uid}`]: role,
		});

	test("with an invitation, the guest joins the event", async () => {
		await seedInvite();
		await assertSucceeds(accept(GUEST));
	});

	test("without an invitation, nobody joins", async () => {
		// This is the defect the consent model exists to fix: before it, the owner
		// could push anyone into their event unasked.
		await assertFails(accept(STRANGER));
	});

	test("the role has to be the one that was offered", async () => {
		await seedInvite({ role: "viewer" });
		await assertFails(accept(GUEST, "editor"));
	});

	test("an invitation for one event does not open another", async () => {
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), "events/other-event"), anEvent());
		});
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(GUEST), "events/other-event"), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("accepting cannot smuggle in a content change", async () => {
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
				title: "Hijacked",
			}),
		);
	});

	test("accepting cannot drag anyone else in", async () => {
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST, STRANGER),
				[`roles.${GUEST}`]: "viewer",
				[`roles.${STRANGER}`]: "editor",
			}),
		);
	});

	test("accepting and clearing the invitation is one atomic write", async () => {
		await seedInvite();
		const db = as(GUEST);
		const batch = writeBatch(db);
		batch.update(doc(db, EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		batch.delete(doc(db, INVITE));
		await assertSucceeds(batch.commit());
	});
});

describe("declining and revoking", () => {
	test("the invitee can decline", async () => {
		await seedInvite();
		await assertSucceeds(deleteDoc(doc(as(GUEST), INVITE)));
	});

	test("the owner can revoke", async () => {
		await seedInvite();
		await assertSucceeds(deleteDoc(doc(as(OWNER), INVITE)));
	});

	test("a stranger can do neither", async () => {
		await seedInvite();
		await assertFails(deleteDoc(doc(as(STRANGER), INVITE)));
	});

	test("the owner can still change the role while it is pending", async () => {
		// Nobody has decided anything yet, and the invitee reads the role live
		// when they do.
		await seedInvite();
		await assertSucceeds(updateDoc(doc(as(OWNER), INVITE), { role: "editor" }));
	});

	test("changing the role cannot change anything else", async () => {
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(OWNER), INVITE), {
				role: "editor",
				inviteeUid: STRANGER,
			}),
		);
		await assertFails(
			updateDoc(doc(as(OWNER), INVITE), { role: "editor", eventId: "other" }),
		);
	});

	test("the invitee cannot promote themselves through the invitation", async () => {
		// The offer is the owner's to make: otherwise accepting would just be a
		// matter of rewriting what was offered first.
		await seedInvite();
		await assertFails(updateDoc(doc(as(GUEST), INVITE), { role: "editor" }));
	});

	test("a stranger cannot touch it either", async () => {
		await seedInvite();
		await assertFails(updateDoc(doc(as(STRANGER), INVITE), { role: "editor" }));
	});
});
