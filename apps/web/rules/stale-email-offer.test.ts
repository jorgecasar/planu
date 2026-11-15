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

/**
 * Removed, then the record erased. The guest can't erase a tombstone (ADR
 * 0015), so the owner does: with the id free, only a spent offer stops them.
 */
async function removedAndErased() {
	const o = owner();
	const batch = writeBatch(o);
	batch.update(doc(o, EVENT), { memberIds: [OWNER], roles: {} });
	batch.set(doc(o, INVITE), {
		eventId: "an-event",
		inviteeUid: GUEST,
		invitedBy: OWNER,
		status: "removed",
		decidedAt: serverTimestamp(),
	});
	await assertSucceeds(batch.commit());
	await assertSucceeds(deleteDoc(doc(o, INVITE)));
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
		const g = guest();
		const leave = writeBatch(g);
		leave.update(doc(g, EVENT), {
			memberIds: arrayRemove(GUEST),
			[`roles.${GUEST}`]: deleteField(),
		});
		leave.set(doc(g, INVITE), {
			eventId: "an-event",
			inviteeUid: GUEST,
			invitedBy: OWNER,
			status: "removed",
			decidedAt: serverTimestamp(),
		});
		await assertSucceeds(leave.commit());
		await assertFails(claim("editor"));
		await assertFails(claimOnly("editor"));
	});
});

// ADR 0015: removing or leaving leaves a tombstone at the guest's id, so no
// offer can be redeemed there, whatever address the removal could not find.
describe("a tombstone keeps a removed guest out", () => {
	const E2 = "guest.new@example.com";
	const OFFER2 = `eventInvitesByEmail/an-event_${createHash("sha256").update(E2).digest("hex")}`;
	const TOMBSTONE = () => ({
		eventId: "an-event",
		inviteeUid: GUEST,
		invitedBy: OWNER,
		status: "removed",
		decidedAt: serverTimestamp(),
	});
	const asGuest = (email: string, verified = true) =>
		env
			.authenticatedContext(GUEST, { email, email_verified: verified })
			.firestore();
	const offerTo = (path: string, email: string) =>
		assertSucceeds(
			setDoc(doc(owner(), path), {
				...anOffer(),
				inviteeEmail: email,
				createdAt: serverTimestamp(),
			}),
		);
	const claimAs = (email: string, path: string) => {
		const g = asGuest(email);
		const batch = writeBatch(g);
		batch.delete(doc(g, path));
		batch.set(doc(g, INVITE), { ...anInvite(), inviteeEmail: email });
		return batch.commit();
	};
	/** `updateEventMembership()`: its offer cleanup can only find EMAIL. */
	const ownerRemoves = (tombstone: object = TOMBSTONE()) => {
		const o = owner();
		const batch = writeBatch(o);
		batch.update(doc(o, EVENT), { memberIds: [OWNER], roles: {} });
		batch.set(doc(o, INVITE), tombstone);
		return batch.commit();
	};

	beforeEach(async () => {
		await seed(EVENT, {
			title: "Concert",
			description: "",
			location: "",
			userId: OWNER,
			startDate: null,
			endDate: null,
			imageUrl: "",
			memberIds: [OWNER, GUEST],
			roles: { [GUEST]: "viewer" },
		});
		await seed(INVITE, { ...anInvite(), status: "accepted" });
	});

	test("T5: record erased while a member, offer to the same address", async () => {
		await offerTo(OFFER, EMAIL);
		await assertSucceeds(deleteDoc(doc(guest(), INVITE)));
		await assertSucceeds(ownerRemoves());
		await assertFails(deleteDoc(doc(guest(), INVITE)));
		await assertFails(claimAs(EMAIL, OFFER));
	});

	test("V2: an address changed to one the removal cannot find", async () => {
		await offerTo(OFFER2, E2);
		await assertSucceeds(ownerRemoves());
		await assertFails(deleteDoc(doc(asGuest(E2), INVITE)));
		await assertFails(claimAs(E2, OFFER2));
	});

	test("the guest cannot edit, rewrite or write one", async () => {
		await assertFails(setDoc(doc(guest(), INVITE), TOMBSTONE()));
		await assertSucceeds(ownerRemoves());
		await assertFails(updateDoc(doc(guest(), INVITE), { status: "pending" }));
		await assertFails(setDoc(doc(guest(), INVITE), anInvite()));
		await assertFails(setDoc(doc(guest(), INVITE), TOMBSTONE()));
	});

	/** Leaving, with what the batch writes at the guest's id, if anything. */
	const leave = (tombstone?: object) => {
		const g = guest();
		const batch = writeBatch(g);
		batch.update(doc(g, EVENT), {
			memberIds: arrayRemove(GUEST),
			[`roles.${GUEST}`]: deleteField(),
		});
		if (tombstone) batch.set(doc(g, INVITE), tombstone);
		return batch.commit();
	};

	test("V1: leaving takes a tombstone, so an offer sent meanwhile is dead", async () => {
		await offerTo(OFFER, EMAIL);
		await assertFails(leave());
		await assertSucceeds(leave(TOMBSTONE()));
		await assertFails(deleteDoc(doc(guest(), INVITE)));
		await assertFails(claimAs(EMAIL, OFFER));
	});

	test("a leaving guest cannot name themselves as inviter", async () => {
		await assertFails(leave({ ...TOMBSTONE(), invitedBy: GUEST }));
		await assertSucceeds(leave(TOMBSTONE()));
	});

	test("a leaver cannot write a tombstone over someone else's record", async () => {
		const g = guest();
		const batch = writeBatch(g);
		batch.update(doc(g, EVENT), {
			memberIds: arrayRemove(GUEST),
			[`roles.${GUEST}`]: deleteField(),
		});
		batch.set(doc(g, INVITE), TOMBSTONE());
		batch.set(doc(g, "eventInvites/an-event_other-uid"), TOMBSTONE());
		await assertFails(batch.commit());
	});

	test("a removal cannot leave a declined record in the tombstone's place", async () => {
		await assertFails(ownerRemoves({ ...TOMBSTONE(), status: "declined" }));
	});

	test("nor does the owner for a non-member, or with an address on it", async () => {
		await assertFails(ownerRemoves({ ...TOMBSTONE(), inviteeEmail: EMAIL }));
		await assertFails(ownerRemoves({ ...TOMBSTONE(), decidedAt: null }));
		await assertSucceeds(ownerRemoves());
		await assertFails(setDoc(doc(owner(), INVITE), TOMBSTONE()));
	});

	test.each([true, false])(
		"the guest deletes it once the event is gone (verified: %s)",
		async (verified) => {
			await assertSucceeds(ownerRemoves());
			await env.withSecurityRulesDisabled((ctx) =>
				deleteDoc(doc(ctx.firestore(), EVENT)),
			);
			await assertSucceeds(deleteDoc(doc(asGuest(EMAIL, verified), INVITE)));
		},
	);

	test("the owner re-invites by uid, and the guest accepts", async () => {
		await assertSucceeds(ownerRemoves());
		await assertSucceeds(setDoc(doc(owner(), INVITE), anInvite()));
		await assertSucceeds(accept(false));
	});

	// GH-192, characterization of what ADR 0015 left open: these pass today and
	// should be inverted, not deleted, if a later decision closes the gap.
	describe("residual risks of re-inviting a removed guest (GH-192)", () => {
		/** An offer to the address the removal could not find. */
		const staleOffer = (role = "viewer") =>
			assertSucceeds(
				setDoc(doc(owner(), OFFER2), {
					...anOffer(role),
					inviteeEmail: E2,
					createdAt: serverTimestamp(),
				}),
			);
		const claimOfferWithRole = (role: string) => {
			const g = asGuest(E2);
			const batch = writeBatch(g);
			batch.delete(doc(g, OFFER2));
			batch.set(doc(g, INVITE), {
				...anInvite(role),
				inviteeEmail: E2,
			});
			return batch.commit();
		};
		const reinvite = async () => {
			await assertSucceeds(ownerRemoves());
			await assertSucceeds(setDoc(doc(owner(), INVITE), anInvite()));
		};

		test("(c') cancelling the re-invitation deletes the tombstone, so the old offer redeems", async () => {
			await staleOffer();
			await reinvite();
			await assertSucceeds(deleteDoc(doc(owner(), INVITE)));
			await assertSucceeds(claimOfferWithRole("viewer"));
		});

		test("(c) the guest drops the pending re-invitation and redeems the older offer with its role", async () => {
			await staleOffer("editor");
			await reinvite();
			await assertSucceeds(deleteDoc(doc(asGuest(E2), INVITE)));
			await assertSucceeds(claimOfferWithRole("editor"));
		});

		test("the verified owner deletes a tombstone, the unverified one cannot", async () => {
			await assertSucceeds(ownerRemoves());
			const unverified = env
				.authenticatedContext(OWNER, { email_verified: false })
				.firestore();
			await assertFails(deleteDoc(doc(unverified, INVITE)));
			await assertSucceeds(deleteDoc(doc(owner(), INVITE)));
		});
	});

	// Account deletion of a member whose verification lapsed: they cannot
	// leave, but nothing keeps them from erasing their accepted record.
	test("an unverified member still erases their accepted record", async () => {
		await assertSucceeds(deleteDoc(doc(asGuest(EMAIL, false), INVITE)));
	});

	test("a pending record stays erasable, even on an event without memberIds", async () => {
		await seed(EVENT, { title: "Concert", userId: OWNER });
		await seed(INVITE, anInvite());
		await assertSucceeds(deleteDoc(doc(guest(), INVITE)));
	});
});
