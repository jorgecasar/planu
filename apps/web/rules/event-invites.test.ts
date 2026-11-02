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
	type DocumentData,
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

/**
 * A well-formed invitation: pending, with a server-set `createdAt` and no
 * decision yet. Every field a real invitation carries once T40 landed.
 */
const anInvite = (extra: Record<string, unknown> = {}) => ({
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeUid: GUEST,
	invitedBy: OWNER,
	invitedByName: "Ana",
	role: "viewer",
	status: "pending",
	createdAt: serverTimestamp(),
	decidedAt: null,
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

// Verified by default; only the verification tests pass `false`.
const as = (uid: string, emailVerified = true) =>
	env.authenticatedContext(uid, { email_verified: emailVerified }).firestore();

/** Seeds an invitation, bypassing the rules. Pending unless `extra` says otherwise. */
const seedInvite = async (extra: Record<string, unknown> = {}) => {
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(doc(ctx.firestore(), INVITE), anInvite(extra));
	});
};

/**
 * Reads the invitation's real, server-resolved data, bypassing the rules.
 *
 * Needed wherever a test has to reuse the actual stored `createdAt`: it is a
 * server timestamp resolved at write time, not a value the test can predict,
 * and `ownerEditsWhilePending()` now pins it to stay unchanged.
 */
const currentInvite = async (): Promise<DocumentData | undefined> => {
	let data: DocumentData | undefined;
	await env.withSecurityRulesDisabled(async (ctx) => {
		const snapshot = await getDoc(doc(ctx.firestore(), INVITE));
		data = snapshot.data();
	});
	return data;
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

	test("rejects a made-up status", async () => {
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ status: "revoked" })),
		);
	});

	test("an invitation is always born pending, never already decided", async () => {
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ status: "accepted" })),
		);
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ status: "declined" })),
		);
	});

	test("decidedAt must start out null", async () => {
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ decidedAt: Timestamp.now() })),
		);
	});

	test("createdAt comes from the server, not the client", async () => {
		// Success criterion 5 of the spec: a client-forged date is denied even
		// when it is a well-formed timestamp.
		await assertFails(
			setDoc(doc(as(OWNER), INVITE), anInvite({ createdAt: Timestamp.now() })),
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

	test("an unverified invitee can still read their own", async () => {
		await seedInvite();
		await assertSucceeds(getDoc(doc(as(GUEST, false), INVITE)));
		await assertSucceeds(
			getDocs(
				query(
					collection(as(GUEST, false), "eventInvites"),
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
	/**
	 * What the client writes: no read of the event needed, and the invitation
	 * flipped to `accepted` in the same batch so it cannot be reused.
	 */
	const accept = (uid: string, role = "viewer", emailVerified = true) => {
		const db = as(uid, emailVerified);
		const batch = writeBatch(db);
		batch.update(doc(db, EVENT), {
			memberIds: arrayUnion(uid),
			[`roles.${uid}`]: role,
		});
		batch.update(doc(db, `eventInvites/an-event_${uid}`), {
			status: "accepted",
			decidedAt: serverTimestamp(),
		});
		return batch.commit();
	};

	test("with an invitation, the guest joins the event", async () => {
		await seedInvite();
		await assertSucceeds(accept(GUEST));
	});

	test("an unverified guest cannot accept an invitation", async () => {
		await seedInvite();
		await assertFails(accept(GUEST, "viewer", false));
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

	test("accepting and marking the invitation decided is one atomic write", async () => {
		await seedInvite();
		const db = as(GUEST);
		const batch = writeBatch(db);
		batch.update(doc(db, EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		batch.update(doc(db, INVITE), {
			status: "accepted",
			decidedAt: serverTimestamp(),
		});
		await assertSucceeds(batch.commit());
	});

	test("an invitation that is not pending cannot be accepted", async () => {
		// Pins the same requirement from the event side: `acceptsInvite()`
		// checks `get(invitePath()).data.status == 'pending'` before anything
		// else. Without it, conserving the record would silently reopen the
		// door that expulsion is supposed to close.
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(accept(GUEST));

		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(accept(GUEST));
	});
});

describe("declining and revoking", () => {
	test("the invitee declines, and the record survives as declined", async () => {
		await seedInvite();
		await assertSucceeds(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "declined",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("the owner revokes a pending invitation", async () => {
		await seedInvite();
		await assertSucceeds(deleteDoc(doc(as(OWNER), INVITE)));
	});

	test("a stranger can neither delete it nor decide it", async () => {
		await seedInvite();
		await assertFails(deleteDoc(doc(as(STRANGER), INVITE)));
		await assertFails(
			updateDoc(doc(as(STRANGER), INVITE), {
				status: "declined",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("the owner can still change the role while it is pending", async () => {
		// Nobody has decided anything yet, and the invitee reads the role live
		// when they do.
		await seedInvite();
		await assertSucceeds(updateDoc(doc(as(OWNER), INVITE), { role: "editor" }));
	});

	test("the owner cannot backdate createdAt while the invitation is pending", async () => {
		// Security review finding on this PR: of the three update paths,
		// ownerEditsWhilePending() was the only one that never pinned
		// `createdAt`, because `isValidInvite()` only checks that it is *a*
		// timestamp, not *the* original one. A forged date here would ride
		// along permanently into the invitation's final accepted/declined
		// record — exactly the consultable history this feature exists to
		// produce honestly.
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(OWNER), INVITE), {
				createdAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00Z")),
			}),
		);
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

// ─── Deciding, reconsidering, and being readmitted (T40) ────────────────────
//
// The document survives a decision now instead of being deleted, so the rule
// itself has to draw every line that used to be drawn for free by the row not
// existing any more. Each denial below was confirmed to fail against the
// pre-T40 rule (no `status` at all, and `acceptsInvite()` gated on the
// invitation no longer existing) before the new clauses were added — see the
// PR description for the transcript.
describe("deciding, reconsidering, and being readmitted", () => {
	test("the invitee reconsiders a decline and puts it back to pending", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertSucceeds(
			updateDoc(doc(as(GUEST), INVITE), { status: "pending", decidedAt: null }),
		);
	});

	test("but never from accepted: that is what makes being removed final", async () => {
		// Success criterion 3 of the spec. If this ever starts passing, removing
		// a guest means nothing: they simply "reconsider" their way back in.
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(GUEST), INVITE), { status: "pending", decidedAt: null }),
		);
	});

	test("the invitee can flip their own invitation to accepted without joining the event", async () => {
		// Documented gap, not a fix: `invitedDecides()` only constrains the
		// invitation side of a decision. The atomicity guarantee — that
		// accepting always joins `memberIds` in the same write — lives on the
		// *event* side instead, in `acceptsInvite()`'s `get`/`getAfter` check,
		// which blocks joining without flipping the invite but not the other
		// way around. This is safe today only because the real client,
		// `acceptInvite()` in `apps/web/src/sharing/invitations.ts`, always
		// batches both writes together — nothing here enforces that a future
		// caller must. If `invitedDecides()` is ever tightened to close this,
		// this test should start failing and can be deleted; until then it
		// exists so the gap is asserted, not just implied by its absence.
		await seedInvite();
		await assertSucceeds(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "accepted",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("removing someone is final once the invitation is spent", async () => {
		// The end-to-end version of the test above: the guest actually joins,
		// gets removed, and cannot use the same invitation to walk back in
		// because it no longer reads `pending` — it still exists, just spent.
		await seedInvite();

		const db = as(GUEST);
		const batch = writeBatch(db);
		batch.update(doc(db, EVENT), {
			memberIds: arrayUnion(GUEST),
			[`roles.${GUEST}`]: "viewer",
		});
		batch.update(doc(db, INVITE), {
			status: "accepted",
			decidedAt: serverTimestamp(),
		});
		await assertSucceeds(batch.commit());

		// The owner removes them, bypassing the rules to isolate this test from
		// the leaving/removal path, which is covered elsewhere.
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), EVENT), anEvent());
		});

		// And they cannot let themselves back in: the invitation is not absent,
		// it is `accepted`, and `acceptsInvite()` requires `pending`.
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("accepting an already-accepted invitation is denied", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "accepted",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("declining an already-declined invitation is denied", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "declined",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("declining directly from accepted is denied: there is no such move", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "declined",
				decidedAt: serverTimestamp(),
			}),
		);
	});

	test("the role cannot change in the same write that decides", async () => {
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(GUEST), INVITE), {
				status: "accepted",
				decidedAt: serverTimestamp(),
				role: "editor",
			}),
		);
	});

	test("the owner readmits from accepted back to pending", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertSucceeds(
			updateDoc(doc(as(OWNER), INVITE), { status: "pending", decidedAt: null }),
		);
	});

	test("the owner readmits from declined back to pending", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertSucceeds(
			updateDoc(doc(as(OWNER), INVITE), { status: "pending", decidedAt: null }),
		);
	});

	test("readmitting cannot change the role in the same write", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(OWNER), INVITE), {
				status: "pending",
				decidedAt: null,
				role: "editor",
			}),
		);
	});

	test("readmitting must clear decidedAt, not leave the old one behind", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(updateDoc(doc(as(OWNER), INVITE), { status: "pending" }));
	});

	test("a stranger cannot readmit anyone", async () => {
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertFails(
			updateDoc(doc(as(STRANGER), INVITE), {
				status: "pending",
				decidedAt: null,
			}),
		);
	});
});

describe("an invitation is a single-use key", () => {
	test("accepting without consuming it is denied", async () => {
		// Left untouched, the invitation still reads `pending` after the write:
		// its holder could walk back in after being removed, as often as they
		// like.
		await seedInvite();
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("an invitation naming someone else does not work", async () => {
		// The document id is built by concatenation; what counts is what the
		// document says, not what its name suggests.
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(
				doc(ctx.firestore(), INVITE),
				anInvite({ inviteeUid: STRANGER }),
			);
		});
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});

	test("an invitation naming another event does not work", async () => {
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(
				doc(ctx.firestore(), INVITE),
				anInvite({ eventId: "another-event" }),
			);
		});
		await assertFails(
			updateDoc(doc(as(GUEST), EVENT), {
				memberIds: arrayUnion(GUEST),
				[`roles.${GUEST}`]: "viewer",
			}),
		);
	});
});

describe("re-inviting after something changed", () => {
	// While the invitation is still pending, a full setDoc goes through
	// `ownerEditsWhilePending()`, which pins `createdAt` to its stored value —
	// editing the offer is not the same as starting a new one. Each test reads
	// the real, server-resolved value back and reuses it, since the default in
	// `anInvite()` is a fresh `serverTimestamp()` sentinel that would otherwise
	// resolve to a different moment on every write.
	test("the title can change between invitations", async () => {
		// setDoc rewrites the whole document, so pinning every field but `role`
		// made a perfectly ordinary re-invitation fail — after renaming the
		// event, or once the owner had set a display name.
		await seedInvite();
		const stored = await currentInvite();
		await assertSucceeds(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ eventTitle: "Renamed", createdAt: stored?.["createdAt"] }),
			),
		);
	});

	test("the inviter's display name can change too", async () => {
		await seedInvite();
		const stored = await currentInvite();
		await assertSucceeds(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({
					invitedByName: "Ana Nueva",
					createdAt: stored?.["createdAt"],
				}),
			),
		);
	});

	test("but never the event, the recipient or who invites", async () => {
		await seedInvite();
		const stored = await currentInvite();
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({
					eventId: "another-event",
					createdAt: stored?.["createdAt"],
				}),
			),
		);
		await assertFails(
			setDoc(
				doc(as(OWNER), INVITE),
				anInvite({ inviteeUid: STRANGER, createdAt: stored?.["createdAt"] }),
			),
		);
	});
});

// ─── Re-offering a decided invitation (security review + correctness review) ─
//
// `inviteToEvent()` always does a full setDoc with a fresh `createdAt`. Once
// an invitation has been decided it is never deleted, so Firestore evaluates
// that same call as an `update`, not a `create` — and none of the other three
// update paths permitted it: `ownerEditsWhilePending()` requires the previous
// state to already be pending, `invitedDecides()` requires the invitee to be
// the one writing, and `ownerReadmits()` restricts the diff to exactly
// `status`/`decidedAt`, which a fresh `createdAt` (and any changed
// `eventTitle`/`role`) always violates. `ownerReoffers()` is what closes that
// gap: this is the exact write shape `inviteToEvent()` sends.
describe("re-offering a decided invitation (inviteToEvent's real write shape)", () => {
	/** What `inviteToEvent()` actually sends: a full replacement via setDoc. */
	const reoffer = (extra: Record<string, unknown> = {}) =>
		setDoc(doc(as(OWNER), INVITE), anInvite(extra));

	test("re-inviting someone who declined starts a fresh pending offer", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertSucceeds(reoffer());
	});

	test("re-inviting someone removed after accepting starts a fresh offer too", async () => {
		// The scenario the spec calls out by name: expelling someone leaves
		// their invitation `accepted`, and the owner's only way back in is to
		// invite again — this exact write, unassisted by any other code path.
		await seedInvite({ status: "accepted", decidedAt: serverTimestamp() });
		await assertSucceeds(reoffer());
	});

	test("the role and the copied text may change when re-offering", async () => {
		await seedInvite({
			status: "declined",
			decidedAt: serverTimestamp(),
			role: "viewer",
		});
		await assertSucceeds(reoffer({ role: "editor", eventTitle: "Renamed" }));
	});

	test("createdAt is still the server's to set, even when re-offering", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(
			reoffer({ createdAt: Timestamp.fromDate(new Date("2000-01-01")) }),
		);
	});

	test("decidedAt must come back null, not survive the re-offer", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(reoffer({ decidedAt: serverTimestamp() }));
	});

	test("re-offering cannot land already decided", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(reoffer({ status: "accepted" }));
	});

	test("a stranger cannot re-offer someone else's invitation", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(setDoc(doc(as(STRANGER), INVITE), anInvite()));
	});

	test("the invitee cannot re-offer their own decided invitation", async () => {
		// Re-offering is the owner's move alone — otherwise "declining" would be
		// reversible by the same person who declined, just via a different door
		// than the reconsider path already covered above.
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(setDoc(doc(as(GUEST), INVITE), anInvite()));
	});

	test("re-offering cannot smuggle in a different event or recipient", async () => {
		await seedInvite({ status: "declined", decidedAt: serverTimestamp() });
		await assertFails(reoffer({ eventId: "another-event" }));
		await assertFails(reoffer({ inviteeUid: STRANGER }));
	});
});

describe("an unverified email cannot touch invitations", () => {
	const owner = () => as(OWNER, false);
	const guest = () => as(GUEST, false);

	test.each([
		["invite", undefined, () => setDoc(doc(owner(), INVITE), anInvite())],
		[
			"edit a pending invitation",
			{},
			() => updateDoc(doc(owner(), INVITE), { role: "editor" }),
		],
		["revoke a pending invitation", {}, () => deleteDoc(doc(owner(), INVITE))],
		[
			"readmit someone",
			{ status: "accepted", decidedAt: serverTimestamp() },
			() =>
				updateDoc(doc(owner(), INVITE), { status: "pending", decidedAt: null }),
		],
		[
			"re-offer a decided invitation",
			{ status: "declined", decidedAt: serverTimestamp() },
			() => setDoc(doc(owner(), INVITE), anInvite()),
		],
	] as const)("the owner cannot %s", async (_name, seed, write) => {
		if (seed) await seedInvite(seed);
		await assertFails(write());
	});

	// On the invitation alone, without the `events` half of the batch.
	test.each(["accepted", "declined"])(
		"the invitee cannot mark it %s",
		async (status) => {
			await seedInvite();
			await assertFails(
				updateDoc(doc(guest(), INVITE), {
					status,
					decidedAt: serverTimestamp(),
				}),
			);
		},
	);
});

// Account deletion erases both sides of every invitation (ADR 0013).
describe("erasing an invitation", () => {
	const STATES = [
		["pending", {}],
		["accepted", { status: "accepted", decidedAt: serverTimestamp() }],
		["declined", { status: "declined", decidedAt: serverTimestamp() }],
	] as const;

	test.each(STATES)(
		"the verified invitee deletes their own invitation while %s",
		async (_status, seed) => {
			await seedInvite(seed);
			await assertSucceeds(deleteDoc(doc(as(GUEST), INVITE)));
		},
	);

	test.each(STATES)(
		"the unverified invitee deletes their own invitation while %s",
		async (_status, seed) => {
			await seedInvite(seed);
			await assertSucceeds(deleteDoc(doc(as(GUEST, false), INVITE)));
		},
	);

	test.each(STATES)(
		"the verified inviter deletes the invitation while %s",
		async (_status, seed) => {
			await seedInvite(seed);
			await assertSucceeds(deleteDoc(doc(as(OWNER), INVITE)));
		},
	);

	test.each(STATES)(
		"an unverified inviter cannot delete it while %s",
		async (_status, seed) => {
			await seedInvite(seed);
			await assertFails(deleteDoc(doc(as(OWNER, false), INVITE)));
		},
	);

	test.each(STATES)(
		"a third user cannot delete it while %s",
		async (_status, seed) => {
			await seedInvite(seed);
			await assertFails(deleteDoc(doc(as(STRANGER), INVITE)));
		},
	);

	test("an invitee cannot delete an invitation addressed to someone else", async () => {
		const other = `eventInvites/an-event_${STRANGER}`;
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(
				doc(ctx.firestore(), other),
				anInvite({ inviteeUid: STRANGER }),
			);
		});
		await assertFails(deleteDoc(doc(as(GUEST), other)));
		await assertFails(deleteDoc(doc(as(GUEST, false), other)));
	});

	test.each([
		["received", "inviteeUid", GUEST],
		["sent", "invitedBy", OWNER],
	])(
		"the %s query used by account deletion is allowed",
		async (_n, field, uid) => {
			await seedInvite();
			await assertSucceeds(
				getDocs(
					query(
						collection(as(uid, false), "eventInvites"),
						where(field, "==", uid),
					),
				),
			);
		},
	);
});
