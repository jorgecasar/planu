import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	arrayRemove,
	arrayUnion,
	deleteDoc,
	deleteField,
	doc,
	serverTimestamp,
	setDoc,
	updateDoc,
	writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

// GH-147: an email offer that outlives a join lets the guest back in once
// removed: they erase their own record (ADR 0013) and claim it.

const OWNER = "owner-uid";
const GUEST = "guest-uid";
const EMAIL = "guest@example.com";
const HASH = createHash("sha256").update(EMAIL).digest("hex");
const EVENT = "events/an-event";
const INVITE = `eventInvites/an-event_${GUEST}`;
const OFFER = `eventInvitesByEmail/an-event_${HASH}`;

const anOffer = (role = "viewer") => ({
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeEmail: EMAIL,
	invitedBy: OWNER,
	invitedByName: "Ana",
	role,
});
const anInvite = (role = "viewer") => ({
	...anOffer(role),
	inviteeUid: GUEST,
	status: "pending",
	createdAt: serverTimestamp(),
	decidedAt: null,
});

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-stale-offer-test",
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
const seedOffer = (role = "viewer") =>
	seed(OFFER, { ...anOffer(role), createdAt: serverTimestamp() });

beforeEach(async () => {
	await env.clearFirestore();
	await seed(EVENT, {
		title: "Concert",
		description: "",
		location: "",
		userId: OWNER,
		startDate: null,
		endDate: null,
		imageUrl: "",
		memberIds: [OWNER],
		roles: {},
	});
});

const owner = () =>
	env.authenticatedContext(OWNER, { email_verified: true }).firestore();
const guest = () =>
	env
		.authenticatedContext(GUEST, { email: EMAIL, email_verified: true })
		.firestore();

// Every setup step is wrapped in `assertSucceeds`: a denial there would
// throw a permission error that `assertFails` on the claim takes for its own.

/** An old client or tab: an email offer, and a uid invite beside it. */
async function offerThenInviteByUid(role = "viewer") {
	await seedOffer(role);
	await assertSucceeds(setDoc(doc(owner(), INVITE), anInvite(role)));
}

function accept(spendOffer: boolean, role = "viewer") {
	const g = guest();
	const batch = writeBatch(g);
	if (spendOffer) batch.delete(doc(g, OFFER));
	batch.update(doc(g, EVENT), {
		memberIds: arrayUnion(GUEST),
		[`roles.${GUEST}`]: role,
	});
	batch.update(doc(g, INVITE), {
		status: "accepted",
		decidedAt: serverTimestamp(),
	});
	return batch.commit();
}

/** The guest keeps the offer if the rules let them, else joins spending it. */
const join = (role = "viewer") =>
	accept(false, role).catch(() => assertSucceeds(accept(true, role)));

/** Removed, then their own record erased (ADR 0013). */
async function removedAndErased() {
	await assertSucceeds(
		updateDoc(doc(owner(), EVENT), { memberIds: [OWNER], roles: {} }),
	);
	await assertSucceeds(deleteDoc(doc(guest(), INVITE)));
}

/** Copied field for field from the offer, as `claimsOffer()` requires. */
function claim(role = "viewer") {
	const g = guest();
	const batch = writeBatch(g);
	batch.delete(doc(g, OFFER));
	batch.set(doc(g, INVITE), anInvite(role));
	return batch.commit();
}

// Not denied for a missing delete, as `claim()` also is: only the
// `claimsOffer()` lookup can refuse this one.
const claimOnly = (role = "viewer") =>
	setDoc(doc(guest(), INVITE), anInvite(role));

describe("joining by uid spends the email offer to that address", () => {
	test("an accept that leaves the offer behind is denied", async () => {
		await offerThenInviteByUid();
		await assertFails(accept(false));
		await assertSucceeds(accept(true));
	});

	test("so once removed, the guest cannot claim it (T3)", async () => {
		await offerThenInviteByUid();
		await join();
		await removedAndErased();
		await assertFails(claim());
		await assertFails(claimOnly());
	});

	test("nor take back a role they were downgraded from (T4)", async () => {
		await offerThenInviteByUid("editor");
		await join("editor");
		const downgrade = { [`roles.${GUEST}`]: "viewer" };
		await assertSucceeds(updateDoc(doc(owner(), EVENT), downgrade));
		const leave = {
			memberIds: arrayRemove(GUEST),
			[`roles.${GUEST}`]: deleteField(),
		};
		await assertSucceeds(updateDoc(doc(guest(), EVENT), leave));
		await assertSucceeds(deleteDoc(doc(guest(), INVITE)));
		await assertFails(claim("editor"));
		await assertFails(claimOnly("editor"));
	});
});
