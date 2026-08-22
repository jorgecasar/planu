import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	addDoc,
	arrayUnion,
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
	writeBatch,
} from "firebase/firestore";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

const VICTIM = "victima-uid";
const ATTACKER = "atacante-uid";
const VIEWER = "viewer-uid";
const EDITOR = "editor-uid";

let env: RulesTestEnvironment;

const anEvent = (userId: string, extra: Record<string, unknown> = {}) => ({
	title: "Concierto de verano",
	description: "Live music",
	location: "Madrid",
	userId,
	startDate: null,
	endDate: null,
	imageUrl: "",
	// The owner is always a member of their own event: that is what makes the
	// `array-contains` query return their own events too.
	memberIds: [userId],
	roles: {},
	...extra,
});

/** The victim's event, with a viewer and an editor invited. */
const sharedEvent = (extra: Record<string, unknown> = {}) =>
	anEvent(VICTIM, {
		memberIds: [VICTIM, VIEWER, EDITOR],
		roles: { [VIEWER]: "viewer", [EDITOR]: "editor" },
		...extra,
	});

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-rules-test",
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
	// Two of the victim's events, written bypassing the rules: one only hers and
	// one with guests.
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(doc(ctx.firestore(), "events/victim-event"), anEvent(VICTIM));
		await setDoc(doc(ctx.firestore(), "events/shared-event"), sharedEvent());
	});
});

const asAttacker = () => env.authenticatedContext(ATTACKER).firestore();
const asVictim = () => env.authenticatedContext(VICTIM).firestore();
const asViewer = () => env.authenticatedContext(VIEWER).firestore();
const asEditor = () => env.authenticatedContext(EDITOR).firestore();
const asAnonymous = () => env.unauthenticatedContext().firestore();

describe("privacy between users", () => {
	test("the owner reads their own event", async () => {
		await assertSucceeds(getDoc(doc(asVictim(), "events/victim-event")));
	});

	test("another user cannot read someone else's event by id", async () => {
		await assertFails(getDoc(doc(asAttacker(), "events/victim-event")));
	});

	test("another user cannot list the victim's events", async () => {
		await assertFails(
			getDocs(
				query(
					collection(asAttacker(), "events"),
					where("userId", "==", VICTIM),
				),
			),
		);
	});

	test("nobody can list the whole collection unfiltered", async () => {
		await assertFails(getDocs(collection(asAttacker(), "events")));
	});

	test("without a session nothing is read", async () => {
		// This is the leak the prototype shipped with: allow read: if true.
		await assertFails(getDoc(doc(asAnonymous(), "events/victim-event")));
		await assertFails(getDocs(collection(asAnonymous(), "events")));
	});
});

describe("ownership", () => {
	test("cannot create an event on someone else's behalf", async () => {
		await assertFails(
			addDoc(collection(asAttacker(), "events"), anEvent(VICTIM)),
		);
	});

	test("cannot modify someone else's event", async () => {
		await assertFails(
			setDoc(
				doc(asAttacker(), "events/victim-event"),
				anEvent(VICTIM, { title: "Secuestrado" }),
			),
		);
	});

	test("cannot steal ownership in an update", async () => {
		await assertFails(
			setDoc(doc(asAttacker(), "events/victim-event"), anEvent(ATTACKER)),
		);
	});

	test("cannot delete someone else's event", async () => {
		await assertFails(deleteDoc(doc(asAttacker(), "events/victim-event")));
	});

	test("the owner can modify and delete their own", async () => {
		await assertSucceeds(
			setDoc(
				doc(asVictim(), "events/victim-event"),
				anEvent(VICTIM, { title: "New title" }),
			),
		);
		await assertSucceeds(deleteDoc(doc(asVictim(), "events/victim-event")));
	});

	test("without a session nothing can be created", async () => {
		await assertFails(
			addDoc(collection(asAnonymous(), "events"), anEvent(ATTACKER)),
		);
	});
});

describe("document shape and size", () => {
	test("a valid create by the user themselves is accepted", async () => {
		await assertSucceeds(
			addDoc(collection(asAttacker(), "events"), anEvent(ATTACKER)),
		);
	});

	test("accepts dates as Timestamp", async () => {
		await assertSucceeds(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, {
					startDate: Timestamp.fromDate(new Date("2026-06-01")),
					endDate: Timestamp.fromDate(new Date("2026-06-15")),
				}),
			),
		);
	});

	test("rejects filler fields: that is the cost vector", async () => {
		// The auditor slipped a 900 KB document past the previous rules.
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { junk: "x".repeat(900 * 1024) }),
			),
		);
	});

	test("rejects an unknown field however tiny", async () => {
		await assertFails(
			addDoc(collection(asAttacker(), "events"), anEvent(ATTACKER, { a: 1 })),
		);
	});

	test("rejects types that would break the listing on the client", async () => {
		// A numeric description used to blow up `.toLowerCase()` in render().
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { description: 123 }),
			),
		);
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { location: { anidado: true } }),
			),
		);
	});

	test("rejects oversized text field by field", async () => {
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { description: "x".repeat(5001) }),
			),
		);
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { title: "x".repeat(201) }),
			),
		);
	});

	test("rejects a title shorter than the client minimum", async () => {
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { title: "ab" }),
			),
		);
	});

	test("rejects a create missing required fields", async () => {
		await assertFails(
			addDoc(collection(asAttacker(), "events"), {
				title: "Title only",
				userId: ATTACKER,
			}),
		);
	});
});

describe("gaps the audit pointed out", () => {
	test("the owner cannot reassign their event to another user", async () => {
		// Isolated on purpose: the theft tests used an attacker who already
		// failed on isOwner(), so dropping the userId immutability clause would
		// have left them passing regardless.
		await assertFails(
			updateDoc(doc(asVictim(), "events/victim-event"), {
				userId: ATTACKER,
			}),
		);
	});

	test("the owner can query their own filtered list", async () => {
		// This is the query the application actually makes; only the attacker's
		// case was covered, so breaking the user's own listing went unnoticed.
		//
		// Since ADR 0006 it filters by `memberIds`, not `userId`: under
		// `read: isMember()`, a query by `userId` no longer guarantees that
		// everything it returns is readable, so Firestore denies it outright.
		await assertSucceeds(
			getDocs(
				query(
					collection(asVictim(), "events"),
					where("memberIds", "array-contains", VICTIM),
				),
			),
		);
	});

	test("rejects dates that are not Timestamps", async () => {
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { startDate: Date.now() }),
			),
		);
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { endDate: "2026-06-01" }),
			),
		);
	});

	test("rejects an imageUrl above the cap", async () => {
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { imageUrl: `https://x/${"a".repeat(2049)}` }),
			),
		);
	});

	test("accepts the limits exactly, not just rejects above them", async () => {
		// Turning a <= into a < would break no other test.
		await assertSucceeds(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, {
					title: "x".repeat(200),
					description: "x".repeat(5000),
					location: "x".repeat(200),
				}),
			),
		);
		await assertSucceeds(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { title: "abc" }),
			),
		);
	});

	test("without a session nothing is modified or deleted either", async () => {
		await assertFails(
			updateDoc(doc(asAnonymous(), "events/victim-event"), { title: "hola" }),
		);
		await assertFails(deleteDoc(doc(asAnonymous(), "events/victim-event")));
	});
});

// ─── Sharing with invited members (ADR 0006) ────────────────────────────────

describe("what each role may do", () => {
	test("a viewer reads but does not write", async () => {
		await assertSucceeds(getDoc(doc(asViewer(), "events/shared-event")));
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				title: "Editado por el lector",
			}),
		);
	});

	test("an editor reads and edits the content", async () => {
		await assertSucceeds(getDoc(doc(asEditor(), "events/shared-event")));
		await assertSucceeds(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				title: "Editado por el editor",
			}),
		);
	});

	test("a stranger neither reads nor writes an event shared with others", async () => {
		await assertFails(getDoc(doc(asAttacker(), "events/shared-event")));
		await assertFails(
			updateDoc(doc(asAttacker(), "events/shared-event"), {
				title: "Secuestrado",
			}),
		);
	});

	test("neither viewer nor editor can delete the event", async () => {
		await assertFails(deleteDoc(doc(asViewer(), "events/shared-event")));
		await assertFails(deleteDoc(doc(asEditor(), "events/shared-event")));
	});

	test("the owner does delete a shared event", async () => {
		await assertSucceeds(deleteDoc(doc(asVictim(), "events/shared-event")));
	});
});

describe("only the owner touches membership", () => {
	test("an editor cannot promote themselves", async () => {
		// The most obvious attack: if `roles` were editable by an editor, the
		// viewer role would mean nothing.
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor", extra: "editor" },
			}),
		);
	});

	test("an editor cannot invite anyone", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR, ATTACKER],
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor", [ATTACKER]: "viewer" },
			}),
		);
	});

	test("an editor cannot remove the viewer", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
			}),
		);
	});

	test("an editor cannot take ownership", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				userId: EDITOR,
			}),
		);
	});

	test("nobody can add themselves to someone else's event", async () => {
		await assertFails(
			updateDoc(doc(asAttacker(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR, ATTACKER],
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor", [ATTACKER]: "editor" },
			}),
		);
	});

	test("the owner changes a guest's role", async () => {
		await assertSucceeds(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR],
				roles: { [VIEWER]: "editor", [EDITOR]: "editor" },
			}),
		);
	});

	test("the owner removes guests", async () => {
		await assertSucceeds(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM],
				roles: {},
			}),
		);
	});

	test("not even the owner can add a member directly", async () => {
		// The consent gate is only real if it lives here. This test used to
		// assert the opposite — it accepted the owner writing a uid straight
		// into memberIds, which is exactly the abuse invitations exist to stop,
		// and so the suite pinned the bypass instead of the rule.
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR, ATTACKER],
				roles: {
					[VIEWER]: "viewer",
					[EDITOR]: "editor",
					[ATTACKER]: "viewer",
				},
			}),
		);
	});

	test("the owner cannot remove themselves from the member list", async () => {
		// It would strand the event with no administrator, and drop it from
		// their own listing.
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VIEWER, EDITOR],
			}),
		);
	});

	test("rejects a made-up role", async () => {
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				roles: { [VIEWER]: "admin", [EDITOR]: "editor" },
			}),
		);
	});

	test("rejects a role for a non-member", async () => {
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor", [ATTACKER]: "viewer" },
			}),
		);
	});

	test("the owner carries no entry in roles", async () => {
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				roles: { [VICTIM]: "editor", [VIEWER]: "viewer", [EDITOR]: "editor" },
			}),
		);
	});
});

describe("leaving someone else's event", () => {
	test("a viewer can remove themselves", async () => {
		await assertSucceeds(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
			}),
		);
	});

	test("leaving cannot smuggle in a content change", async () => {
		// Without bounding which fields change, leaving would be a way to edit.
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
				title: "Colado al salir",
			}),
		);
	});

	test("leaving is not a way to remove someone else", async () => {
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER],
				roles: { [VIEWER]: "viewer" },
			}),
		);
	});

	test("the owner cannot leave their own event", async () => {
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VIEWER, EDITOR],
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor" },
			}),
		);
	});
});

describe("queries for the shared inbox", () => {
	test("each user lists the events they are a member of", async () => {
		await assertSucceeds(
			getDocs(
				query(
					collection(asViewer(), "events"),
					where("memberIds", "array-contains", VIEWER),
				),
			),
		);
	});

	test("cannot list by another person's uid", async () => {
		await assertFails(
			getDocs(
				query(
					collection(asAttacker(), "events"),
					where("memberIds", "array-contains", VIEWER),
				),
			),
		);
	});
});

describe("membership shape on create", () => {
	test("a new event starts with its creator as sole member", async () => {
		await assertSucceeds(
			addDoc(collection(asAttacker(), "events"), anEvent(ATTACKER)),
		);
	});

	test("cannot be born with guests already inside", async () => {
		// If it could, inviting would be a create and would bypass the owner's
		// control.
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, {
					memberIds: [ATTACKER, VICTIM],
					roles: { [VICTIM]: "viewer" },
				}),
			),
		);
	});

	test("cannot be born without being a member of its own event", async () => {
		await assertFails(
			addDoc(
				collection(asAttacker(), "events"),
				anEvent(ATTACKER, { memberIds: [] }),
			),
		);
	});

	test("rejects a create with no memberIds or roles", async () => {
		const { memberIds, roles, ...withoutMembership } = anEvent(ATTACKER);
		await assertFails(
			addDoc(collection(asAttacker(), "events"), withoutMembership),
		);
	});

	test("rejects an oversized member list", async () => {
		// `roles` lives inside the document: without a cap it grows to the 1 MiB
		// limit and becomes the cost vector the audit closed.
		const many = Array.from({ length: 40 }, (_, i) => `guest-${i}`);
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, ...many],
				roles: Object.fromEntries(many.map((uid) => [uid, "viewer"])),
			}),
		);
	});
});

// ─── Clauses the suite used to leave unpinned ───────────────────────────────
//
// Every test below was added because deleting the rule clause it names left the
// whole suite green. The earlier attempts sent malformed writes that died in
// isValidMembership before the clause under test was ever reached, so they
// passed without exercising the boundary their name promised.

describe("each membership clause is pinned by a test", () => {
	test("an editor cannot rewrite roles even with a well-formed map", async () => {
		// Pins `roles == roles` in changesContentOnly. Promoting the viewer keeps
		// memberIds untouched and the map internally consistent, so this write
		// reaches changesContentOnly instead of dying in isValidMembership.
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				roles: { [VIEWER]: "editor", [EDITOR]: "editor" },
			}),
		);
	});

	test("an editor cannot rewrite memberIds even with a well-formed map", async () => {
		// Pins `memberIds == memberIds`. Dropping the viewer from both fields at
		// once keeps the invariants satisfied.
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
			}),
		);
	});

	test("the owner cannot add a member without giving them a role", async () => {
		// Pins `roles.size() == memberIds.size() - 1`.
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR, ATTACKER],
				roles: { [VIEWER]: "viewer", [EDITOR]: "editor" },
			}),
		);
	});

	test("the cap is exactly 21 members: 21 passes, 22 fails", async () => {
		// Pins the boundary itself. The oversized test used 41, so the cap could
		// be weakened to 39 without any test noticing.
		//
		// Checked by trimming the list rather than growing it: since the owner
		// can no longer add members, the only way in is accepting an invitation,
		// and that is covered in event-invites.test.ts.
		const guests = (count: number) =>
			Array.from({ length: count }, (_, i) => `guest-${i}`);
		const withGuests = (count: number) => ({
			memberIds: [VICTIM, ...guests(count)],
			roles: Object.fromEntries(guests(count).map((uid) => [uid, "viewer"])),
		});

		const seed = async (count: number) => {
			await env.withSecurityRulesDisabled(async (ctx) => {
				await setDoc(doc(ctx.firestore(), "events/shared-event"), {
					...anEvent(VICTIM),
					...withGuests(count),
				});
			});
		};

		// 21 members stand; the same document with 22 cannot be written at all.
		await seed(20);
		await assertSucceeds(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				title: "Still fine",
			}),
		);
		await seed(21);
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), { title: "Too many" }),
		);
	});

	test("a role for a non-member fails on hasOnly, not on the size check", async () => {
		// Same number of roles as guests, so the size clause is satisfied and the
		// write has to be stopped by keys().hasOnly(memberIds).
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR],
				roles: { [VIEWER]: "viewer", [ATTACKER]: "editor" },
			}),
		);
	});

	test("a role for the owner fails on its own clause, not on the size check", async () => {
		// Three members, three roles: the size clause passes and only
		// !(userId in roles) can stop it.
		await assertFails(
			updateDoc(doc(asVictim(), "events/shared-event"), {
				memberIds: [VICTIM, VIEWER, EDITOR, ATTACKER],
				roles: {
					[VICTIM]: "editor",
					[VIEWER]: "viewer",
					[EDITOR]: "editor",
				},
			}),
		);
	});

	test("an editor cannot touch createdAt", async () => {
		// T19 will order by this field: an editor able to rewrite it could pin any
		// event to the top of everyone's listing.
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				createdAt: Timestamp.fromDate(new Date("2099-01-01")),
			}),
		);
	});
});

describe("phase 1 events deny cleanly instead of erroring", () => {
	beforeEach(async () => {
		// A document as phase 1 left them: no memberIds, no roles.
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(doc(ctx.firestore(), "events/legacy-event"), {
				title: "From phase 1",
				description: "",
				location: "",
				userId: VICTIM,
				startDate: null,
				endDate: null,
				imageUrl: "",
			});
		});
	});

	test("a stranger is denied, and the denial does not break the query", async () => {
		await assertFails(getDoc(doc(asAttacker(), "events/legacy-event")));
		// The point of the defensive accessors: one legacy document must not take
		// down someone else's whole listing.
		await assertSucceeds(
			getDocs(
				query(
					collection(asAttacker(), "events"),
					where("memberIds", "array-contains", ATTACKER),
				),
			),
		);
	});

	test("not even its owner can read it: only the backfill fixes that", async () => {
		// Documented rather than worked around. Rescuing the owner with an extra
		// clause on `allow read` denies every list query instead, so a legacy
		// event stays invisible until it is migrated. What the defensive
		// accessors buy is that it no longer breaks anyone else's listing.
		await assertFails(getDoc(doc(asVictim(), "events/legacy-event")));
	});
});

describe("the cover image cannot point anywhere", () => {
	test("an editor cannot repoint imageUrl at another host", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				imageUrl: "https://attacker.example/track.gif?u=victim",
			}),
		);
	});

	test("a Storage URL is still accepted", async () => {
		await assertSucceeds(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				imageUrl:
					"https://firebasestorage.googleapis.com/v0/b/planu-app/o/events%2Fx.png?alt=media&token=abc",
			}),
		);
	});
});

describe("tags cannot be used to pad a document", () => {
	const tags = (value: unknown) => anEvent(VICTIM, { tags: value });

	test("an event without tags is still valid", async () => {
		// Everything written before F6 lacks the field. Requiring it would make
		// every existing event uneditable, which is why `tags` is in hasOnly but
		// not in hasAll.
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), anEvent(VICTIM)),
		);
	});

	test("up to ten tags are accepted", async () => {
		const ten = Array.from({ length: 10 }, (_, i) => `tag-${i}`);
		await assertSucceeds(addDoc(collection(asVictim(), "events"), tags(ten)));
	});

	test("an empty list is accepted", async () => {
		await assertSucceeds(addDoc(collection(asVictim(), "events"), tags([])));
	});

	test("eleven tags are denied", async () => {
		const eleven = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
		await assertFails(addDoc(collection(asVictim(), "events"), tags(eleven)));
	});

	test("ten tags of filler are denied by the aggregate bound", async () => {
		// The count alone does not bound cost: ten tags of 100 KB each would
		// pass. This is what the joined-length check exists for.
		const filler = Array.from({ length: 10 }, (_, i) =>
			`${i}`.padEnd(500, "x"),
		);
		await assertFails(addDoc(collection(asVictim(), "events"), tags(filler)));
	});

	test("a single oversized tag is denied", async () => {
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags(["x".repeat(300)])),
		);
	});

	test("duplicates are denied: ten copies are not ten tags", async () => {
		const same = Array.from({ length: 10 }, () => "concierto");
		await assertFails(addDoc(collection(asVictim(), "events"), tags(same)));
	});

	test("tags must be a list, not a string", async () => {
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags("concierto")),
		);
	});

	test("tags must be a list, not a map", async () => {
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags({ a: true })),
		);
	});

	test("a list holding a non-string is denied", async () => {
		// The round trip is what denies the number: `join` coerces 42 to "42",
		// and ['ok', 42] no longer equals ['ok', '42']. The nested map is a
		// different denial — `join` really does error on it — so it is asserted
		// here as a second door, not as evidence for the first.
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags(["ok", 42])),
		);
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags([{ nested: "map" }])),
		);
	});

	test("a tag with a comma is accepted", async () => {
		// The round-trip type check needs a separator, and a comma would have
		// terminated an honest tag right here.
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), tags(["cine, teatro"])),
		);
	});

	test("a tag carrying a newline is denied", async () => {
		// It cannot survive the round trip, and `normalizeTag` would never
		// produce one: collapsing whitespace is what guarantees that.
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags(["cine\nteatro"])),
		);
	});

	test("an editor may retag: tags are content", async () => {
		await assertSucceeds(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				tags: ["concierto"],
			}),
		);
	});

	test("an editor cannot pad through tags either", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
			}),
		);
	});

	test("a viewer cannot tag at all", async () => {
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				tags: ["concierto"],
			}),
		);
	});

	test("a stranger cannot tag someone else's event", async () => {
		await assertFails(
			updateDoc(doc(asAttacker(), "events/victim-event"), { tags: ["x"] }),
		);
	});

	test("the aggregate bound is exactly 280: 280 passes, 281 denies", async () => {
		// Until now the bound was only probed from far away — ten tags of 500 and
		// a single one of 300 — so it could have been weakened to any number
		// between 250 and 299 without a test noticing. A single tag carries no
		// separator, so its length is the joined length.
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), tags(["x".repeat(280)])),
		);
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags(["x".repeat(281)])),
		);
	});

	test("a lone empty string is accepted, unlike a trailing one", async () => {
		// The asymmetry the rule comments out loud: `split` drops a trailing
		// empty field, so ['x', ''] cannot survive the round trip while [''] and
		// ['', 'x'] can. Asserted rather than asserted-in-a-comment, because a
		// comment claiming untested behaviour is how this branch got a reputation.
		await assertSucceeds(addDoc(collection(asVictim(), "events"), tags([""])));
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), tags(["", "x"])),
		);
		await assertFails(
			addDoc(collection(asVictim(), "events"), tags(["x", ""])),
		);
	});
});

describe("allDay is typed but not required (T51/T52)", () => {
	const allDay = (value: unknown) => anEvent(VICTIM, { allDay: value });

	test("an event without allDay is still valid", async () => {
		// Every event written before this feature lacks the field. Requiring it
		// would make every existing event uneditable, which is why `allDay` is
		// in `hasOnly` but not in `hasAll` — same reasoning as `tags`. The
		// client's Zod schema supplies `default(true)` on read.
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), anEvent(VICTIM)),
		);
	});

	test("true and false are both accepted", async () => {
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), allDay(true)),
		);
		await assertSucceeds(
			addDoc(collection(asVictim(), "events"), allDay(false)),
		);
	});

	test("a string is denied, even the literal 'true'", async () => {
		await assertFails(addDoc(collection(asVictim(), "events"), allDay("true")));
	});

	test("a number is denied", async () => {
		await assertFails(addDoc(collection(asVictim(), "events"), allDay(1)));
	});

	test("null is denied: unlike startDate and endDate, this field has no null case", async () => {
		await assertFails(addDoc(collection(asVictim(), "events"), allDay(null)));
	});

	test("an editor may flip allDay: it is content", async () => {
		await assertSucceeds(
			updateDoc(doc(asEditor(), "events/shared-event"), { allDay: false }),
		);
	});

	test("a viewer cannot set allDay at all", async () => {
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), { allDay: false }),
		);
	});
});

// ─── What an editor may write, pinned as a set ──────────────────────────────
//
// `changesContentOnly()` is a blacklist: it names the four fields an editor may
// not touch, so anything added to `hasOnly` becomes editor-writable by default
// and in silence. `tags` landing there needed no change to the function, which
// is exactly how the next field — an activity log, a pinned flag, the owner's
// private notes — would arrive.
describe("the set an editor may write is pinned", () => {
	/** Content: an editor may rewrite each of these on their own. */
	const CONTENT: [string, unknown][] = [
		["title", "Retitulado por el editor"],
		["description", "Otra descripción"],
		["location", "Sevilla"],
		["startDate", Timestamp.fromDate(new Date("2026-09-01"))],
		["endDate", Timestamp.fromDate(new Date("2026-09-02"))],
		[
			"imageUrl",
			"https://firebasestorage.googleapis.com/v0/b/planu-app/o/events%2Fy.png?alt=media&token=abc",
		],
		["tags", ["concierto"]],
		["allDay", false],
	];

	/**
	 * Not content: ownership, membership and the creation stamp.
	 *
	 * `memberIds` goes in as a **reordering**, and that is deliberate. Every
	 * other way of touching it — adding, removing, duplicating — is already
	 * stopped by `isValidMembership()` or by the `roles` clause, so deleting
	 * `memberIds == memberIds` from `changesContentOnly()` left all 88 tests
	 * green. Measured, not assumed. A reordering is the one change that keeps
	 * every invariant and every role intact, so it is the only write that
	 * reaches that clause and nothing else.
	 */
	const NOT_CONTENT: Record<string, Record<string, unknown>> = {
		userId: { userId: EDITOR },
		memberIds: { memberIds: [VICTIM, EDITOR, VIEWER] },
		roles: { roles: { [VIEWER]: "editor", [EDITOR]: "editor" } },
		createdAt: { createdAt: Timestamp.fromDate(new Date("2099-01-01")) },
	};

	test("every field the document may hold is classified as content or not", () => {
		// Read from the rules themselves: widening `hasOnly` without deciding
		// which side the new field falls on fails here, which is the whole point.
		// Classifying it is then a visible diff in this file.
		const rules = readFileSync("../../firestore.rules", "utf8");
		const body = rules.slice(rules.indexOf("function isValidEvent("));
		const declared = body
			.slice(body.indexOf("hasOnly("), body.indexOf("hasAll("))
			.match(/'([^']+)'/g)
			?.map((quoted) => quoted.slice(1, -1));

		expect(declared?.slice().sort()).toEqual(
			[...CONTENT.map(([field]) => field), ...Object.keys(NOT_CONTENT)].sort(),
		);
	});

	test("an editor may rewrite every content field", async () => {
		for (const [field, value] of CONTENT) {
			await assertSucceeds(
				updateDoc(doc(asEditor(), "events/shared-event"), { [field]: value }),
			);
		}
	});

	test("an editor may rewrite none of the others", async () => {
		for (const patch of Object.values(NOT_CONTENT)) {
			await assertFails(
				updateDoc(doc(asEditor(), "events/shared-event"), patch),
			);
		}
	});
});

// ─── Tags cannot ride along a membership write ──────────────────────────────
//
// All three deny today, and none of them denies because of anything in
// `isValidTags`: it is the field-set clauses of the consent paths that stop
// them. A refactor of `changesContentOnly()` or of those `hasOnly` sets could
// reopen any of the three without a single test going red, so each denial is
// paired with the same write minus the tags, which has to pass.
describe("tags cannot travel on a membership write", () => {
	const seedInvite = async () => {
		await env.withSecurityRulesDisabled(async (ctx) => {
			await setDoc(
				doc(ctx.firestore(), `eventInvites/victim-event_${ATTACKER}`),
				{
					eventId: "victim-event",
					eventTitle: "Concierto de verano",
					inviteeUid: ATTACKER,
					invitedBy: VICTIM,
					role: "viewer",
					status: "pending",
					createdAt: serverTimestamp(),
					decidedAt: null,
				},
			);
		});
	};

	/** What the client writes to accept, optionally smuggling a content change. */
	const accept = (extra: Record<string, unknown> = {}) => {
		const db = asAttacker();
		const batch = writeBatch(db);
		batch.update(doc(db, "events/victim-event"), {
			memberIds: arrayUnion(ATTACKER),
			[`roles.${ATTACKER}`]: "viewer",
			...extra,
		});
		batch.update(doc(db, `eventInvites/victim-event_${ATTACKER}`), {
			status: "accepted",
			decidedAt: serverTimestamp(),
		});
		return batch.commit();
	};

	test("accepting an invitation cannot carry tags", async () => {
		await seedInvite();
		// The tags are perfectly valid: what denies is the field set, not
		// isValidTags.
		await assertFails(accept({ tags: ["colada"] }));
		// The control. Without it, the denial above could be about anything.
		await assertSucceeds(accept());
	});

	test("leaving an event cannot carry tags", async () => {
		await assertFails(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
				tags: ["colada"],
			}),
		);
		await assertSucceeds(
			updateDoc(doc(asViewer(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
			}),
		);
	});

	test("an editor cannot ride tags along a membership change", async () => {
		await assertFails(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				memberIds: [VICTIM, EDITOR],
				roles: { [EDITOR]: "editor" },
				tags: ["colada"],
			}),
		);
		// Retagging on its own is content and does pass, so the denial above is
		// about the membership half of the write.
		await assertSucceeds(
			updateDoc(doc(asEditor(), "events/shared-event"), {
				tags: ["colada"],
			}),
		);
	});
});
