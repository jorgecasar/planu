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
	serverTimestamp,
	setDoc,
	writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const OWNER = { uid: "owner-uid", email: "owner@example.com" };
const STRANGER = { uid: "stranger-uid", email: "stranger@example.com" };
// Nobody with an account yet — that is the whole point of this collection.
const NEWCOMER = { uid: "newcomer-uid", email: "newcomer@example.com" };
const OTHER_NEWCOMER = {
	uid: "other-newcomer-uid",
	email: "other-newcomer@example.com",
};

const EVENT_ID = "an-event";
const EVENT = `events/${EVENT_ID}`;

const hash = (email: string) =>
	createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

const pendingId = (eventId: string, email: string) =>
	`${eventId}_${hash(email)}`;

let env: RulesTestEnvironment;

const anEvent = (extra: Record<string, unknown> = {}) => ({
	title: "Concert",
	description: "Live music",
	location: "Madrid",
	userId: OWNER.uid,
	startDate: null,
	endDate: null,
	imageUrl: "",
	memberIds: [OWNER.uid],
	roles: {},
	...extra,
});

/** A well-formed pending-by-email offer, the shape `inviteToEvent()` writes
 * when the invited address has no `userDirectory` entry yet. */
const aPendingInvite = (extra: Record<string, unknown> = {}) => ({
	eventId: EVENT_ID,
	eventTitle: "Concert",
	inviteeEmail: NEWCOMER.email,
	invitedBy: OWNER.uid,
	invitedByName: "Ana",
	role: "viewer",
	createdAt: serverTimestamp(),
	...extra,
});

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
		await setDoc(doc(ctx.firestore(), EVENT), anEvent());
	});
});

const as = (who: { uid: string; email: string }, emailVerified = true) =>
	env
		.authenticatedContext(who.uid, {
			email: who.email,
			email_verified: emailVerified,
		})
		.firestore();

/** Seeds a pending offer, bypassing the rules, and returns its plain data
 * (the fields a test needs are all static strings, never the unresolved
 * `serverTimestamp()` sentinel). */
const seedPendingInvite = async (extra: Record<string, unknown> = {}) => {
	const data = aPendingInvite(extra);
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(
			doc(
				ctx.firestore(),
				`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
			),
			data,
		);
	});
	return data;
};

describe("offering a pending invitation by email", () => {
	test("the owner offers on their own event", async () => {
		await assertSucceeds(
			setDoc(
				doc(
					as(OWNER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, NEWCOMER.email)}`,
				),
				aPendingInvite(),
			),
		);
	});

	test("nobody can offer on an event that is not theirs", async () => {
		// The whole point: without this, a pending offer is just a document
		// anyone can write, regardless of who owns the event.
		await assertFails(
			setDoc(
				doc(
					as(STRANGER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, NEWCOMER.email)}`,
				),
				aPendingInvite({ invitedBy: STRANGER.uid }),
			),
		);
	});

	test("the id's hash must match the invited email in the document", async () => {
		// Same event, same email inside the payload, but an id built from a
		// different address than the one actually stored — isValidPendingInvite()
		// recomputes the hash from the document, not from the path.
		await assertFails(
			setDoc(
				doc(
					as(OWNER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, "someone-else@example.com")}`,
				),
				aPendingInvite(),
			),
		);
	});

	test("without a verified email, the inviter cannot offer either", async () => {
		// It is the INVITER's verification that gates this, not the invitee's —
		// the invitee has no account yet to verify.
		await assertFails(
			setDoc(
				doc(
					as(OWNER, false),
					`eventInvitesByEmail/${pendingId(EVENT_ID, NEWCOMER.email)}`,
				),
				aPendingInvite(),
			),
		);
	});

	test("rejects filler fields", async () => {
		await assertFails(
			setDoc(
				doc(
					as(OWNER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, NEWCOMER.email)}`,
				),
				{ ...aPendingInvite(), relleno: "x".repeat(100 * 1024) },
			),
		);
	});
});

describe("seeing a pending invitation by email", () => {
	test("the owner who offered can read it", async () => {
		const data = await seedPendingInvite();
		await assertSucceeds(
			getDoc(
				doc(
					as(OWNER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});

	test("whoever owns the invited address can read it", async () => {
		const data = await seedPendingInvite();
		await assertSucceeds(
			getDoc(
				doc(
					as(NEWCOMER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});

	test("nobody else can read it, not even another newcomer", async () => {
		const data = await seedPendingInvite();
		await assertFails(
			getDoc(
				doc(
					as(STRANGER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
		await assertFails(
			getDoc(
				doc(
					as(OTHER_NEWCOMER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});

	test("nobody can list the whole collection", async () => {
		// This is what separates checking an id you already hold from
		// downloading the census of who has been invited.
		await seedPendingInvite();
		await assertFails(getDocs(collection(as(NEWCOMER), "eventInvitesByEmail")));
	});

	test("a third party cannot tell an offer apart from an absent one by probing", async () => {
		// Security review finding on this PR. The id is deterministic and
		// sha256 is public and client-computable, so before the fix a
		// verified STRANGER who merely knows an eventId could probe any
		// number of emails one at a time: PERMISSION_DENIED meant a live
		// offer exists at that id, an empty snapshot meant it does not — an
		// oracle stronger than the one ADR 0007 already accepted for
		// userDirectory, which answers identically whichever is true. Both
		// reads below must now be denied identically, live offer or not.
		await seedPendingInvite({ inviteeEmail: "target@example.com" });

		// This id names a real, existing offer.
		await assertFails(
			getDoc(
				doc(
					as(STRANGER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, "target@example.com")}`,
				),
			),
		);

		// This id names one that was never made.
		await assertFails(
			getDoc(
				doc(
					as(STRANGER),
					`eventInvitesByEmail/${pendingId(EVENT_ID, "not-invited@example.com")}`,
				),
			),
		);
	});

	test("checking your own mailbox for an offer that was never made still succeeds", async () => {
		// The legitimate case the gate above must not break: NEWCOMER reads
		// their own deterministic id on an event nobody invited them to, and
		// gets an empty snapshot rather than a denial — the same answer
		// isOwnEmailForId() gives whether an offer exists there or not, and
		// the only case where a nonexistent document is ever readable.
		await assertSucceeds(
			getDoc(
				doc(
					as(NEWCOMER),
					`eventInvitesByEmail/${pendingId("another-event", NEWCOMER.email)}`,
				),
			),
		);
	});
});

describe("claiming a pending invitation by email", () => {
	/**
	 * What the client sends: delete the pending-by-email offer and create the
	 * matching eventInvites document, in one batch — the same pattern
	 * acceptsInvite() already relies on for events accepting an invitation via
	 * a get()/exists() check into another collection.
	 *
	 * `overrides` lets a test forge one field the claimer should not control,
	 * while every other field stays exactly what a real claim would send.
	 */
	const claimWith = (
		who: { uid: string; email: string },
		overrides: Record<string, unknown> = {},
		verified = true,
	) => {
		const db = as(who, verified);
		const batch = writeBatch(db);
		batch.delete(
			doc(db, `eventInvitesByEmail/${pendingId(EVENT_ID, NEWCOMER.email)}`),
		);
		batch.set(doc(db, `eventInvites/${EVENT_ID}_${who.uid}`), {
			eventId: EVENT_ID,
			eventTitle: "Concert",
			inviteeUid: who.uid,
			inviteeEmail: who.email,
			invitedBy: OWNER.uid,
			invitedByName: "Ana",
			role: "viewer",
			status: "pending",
			createdAt: serverTimestamp(),
			decidedAt: null,
			...overrides,
		});
		return batch.commit();
	};

	const claim = (who: { uid: string; email: string }) => claimWith(who);

	test("whoever owns the invited address can claim it", async () => {
		await seedPendingInvite();
		await assertSucceeds(claim(NEWCOMER));
	});

	test("nobody can claim someone else's address", async () => {
		await seedPendingInvite();
		await assertFails(claim(OTHER_NEWCOMER));
		await assertFails(claim(STRANGER));
	});

	// claimsPendingByEmail() checks the claimer's own
	// request.auth.token.email_verified — not `isVerified()` from the events
	// match block, which cannot cross match blocks, but the same claim. This
	// was a real coverage gap (found by a checker on the T65 rules fix, not
	// by any regression): the rule was already correct, but nothing pinned
	// it, so a future edit could have broken it silently.
	//
	// The batch shape (delete + create) cannot isolate this: the delete half,
	// on eventInvitesByEmail, has its own independent isOwnEmail() check that
	// also requires email_verified, so an unverified claimer's batch fails
	// for a reason this test cannot distinguish from the one it means to pin
	// — confirmed by disabling claimsPendingByEmail()'s own check and seeing
	// the batched version of this test still deny, same trap the checker
	// already found in the batched-accept test above. A solo `setDoc` on just
	// `eventInvites`, with no delete in the same operation, is what actually
	// isolates it.
	test("an unverified newcomer cannot claim their own pending invitation", async () => {
		await seedPendingInvite();
		const db = as(NEWCOMER, false);
		await assertFails(
			setDoc(doc(db, `eventInvites/${EVENT_ID}_${NEWCOMER.uid}`), {
				eventId: EVENT_ID,
				eventTitle: "Concert",
				inviteeUid: NEWCOMER.uid,
				inviteeEmail: NEWCOMER.email,
				invitedBy: OWNER.uid,
				invitedByName: "Ana",
				role: "viewer",
				status: "pending",
				createdAt: serverTimestamp(),
				decidedAt: null,
			}),
		);
	});

	test("claiming does not let the claimer pick a different role or inviter", async () => {
		await seedPendingInvite({ role: "viewer", invitedBy: OWNER.uid });

		// Upgraded from the offered "viewer".
		await assertFails(claimWith(NEWCOMER, { role: "editor" }));

		// A forged inviter, distinct from both the offer's real OWNER and
		// from the claimer themselves — isolated from the unrelated rule
		// that an invitation may not name its own recipient as its inviter.
		await assertFails(claimWith(NEWCOMER, { invitedBy: STRANGER.uid }));
	});

	test("claiming cannot forge a different invitee email than the one offered", async () => {
		await seedPendingInvite({ inviteeEmail: NEWCOMER.email });
		await assertFails(
			claimWith(NEWCOMER, { inviteeEmail: "someone-else@example.com" }),
		);
	});

	test("claiming twice does not duplicate anything: the second attempt finds nothing", async () => {
		await seedPendingInvite();
		await assertSucceeds(claim(NEWCOMER));
		// The pending offer no longer exists — the first claim's own batch
		// deleted it — so claimsPendingByEmail()'s exists() check fails and
		// this second attempt is denied cleanly, not duplicated.
		await assertFails(claim(NEWCOMER));
	});
});

describe("withdrawing an unclaimed offer", () => {
	test("the owner deletes a pending offer nobody has claimed", async () => {
		const data = await seedPendingInvite();
		await assertSucceeds(
			deleteDoc(
				doc(
					as(OWNER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});

	test("a stranger cannot withdraw someone else's offer", async () => {
		const data = await seedPendingInvite();
		await assertFails(
			deleteDoc(
				doc(
					as(STRANGER),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});

	// Same gap the eventInvites fix closed, found by a security-auditor pass
	// on that fix: the owner's branch here needed the same email-verified
	// requirement, or an unverified owner could still withdraw an offer even
	// though `allow create` on this very collection already demands it.
	test("an unverified owner cannot withdraw their own offer", async () => {
		const data = await seedPendingInvite();
		await assertFails(
			deleteDoc(
				doc(
					as(OWNER, false),
					`eventInvitesByEmail/${pendingId(data.eventId, data.inviteeEmail)}`,
				),
			),
		);
	});
});
