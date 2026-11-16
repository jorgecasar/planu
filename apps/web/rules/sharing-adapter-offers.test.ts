import { readFileSync } from "node:fs";
import {
	assertFails,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	arrayUnion,
	collection,
	doc,
	type Firestore,
	getDoc,
	getDocs,
	setDoc,
	updateDoc,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { ReceivedInvite } from "../src/application/ports/sharing.js";
import { createAccountDataAdapter } from "../src/infrastructure/firebase/account-data-adapter.js";
import { FirebaseEventRepository } from "../src/infrastructure/firebase/event-repository.js";
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
	// ADR 0015: a tombstone in its place, hidden from the owner's pending
	// list, and a uid re-invite still turns it back into an offer.
	expect(await stored(INVITE)).toMatchObject({ status: "removed" });
	expect(await stored(INVITE)).not.toHaveProperty("inviteeEmail");
	expect(await ownersAdapter().listPendingInvites("an-event", OWNER)).toEqual(
		[],
	);
	await ownersAdapter().inviteToEvent(AN_INVITE);
	expect(await stored(INVITE)).toMatchObject({ status: "pending" });
});

// GH-189 S6: "Volver a invitar" over a tombstone, with the real rules.
test("an editor removed and re-invited comes back only by accepting, with the role they had", async () => {
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.firestore();
		const joined = { memberIds: [OWNER, GUEST], roles: { [GUEST]: "editor" } };
		await setDoc(doc(db, EVENT), joined, { merge: true });
		await setDoc(doc(db, INVITE), {
			...AN_INVITE,
			role: "editor",
			status: "accepted",
		});
	});
	const owner = ownersAdapter();

	const inviteeEmail = await owner.updateEventMembership(
		"an-event",
		{ memberIds: [OWNER], roles: {} },
		GUEST,
	);
	await owner.restoreAccessOffer("an-event", GUEST, "editor", {
		invitedByName: "Ana",
		...(inviteeEmail ? { inviteeEmail } : {}),
	});

	expect(inviteeEmail).toBe("guest@example.com");
	expect(await stored(INVITE)).toMatchObject({
		status: "pending",
		role: "editor",
		inviteeEmail: "guest@example.com",
	});
	// Not a member yet, and no offer by email was left behind.
	expect(await stored(EVENT)).toMatchObject({ memberIds: [OWNER] });
	await env.withSecurityRulesDisabled(async (ctx) => {
		const offers = await getDocs(
			collection(ctx.firestore(), "eventInvitesByEmail"),
		);
		expect(offers.size).toBe(0);
	});
	// The owner cannot let them in on their own: only accepting does.
	const asOwner = env
		.authenticatedContext(OWNER, { email_verified: true })
		.firestore();
	await assertFails(
		updateDoc(doc(asOwner, EVENT), { memberIds: arrayUnion(GUEST) }),
	);

	const asGuest = env
		.authenticatedContext(GUEST, { email_verified: true })
		.firestore() as unknown as Firestore;
	const [received] = await new Promise<ReceivedInvite[]>((resolve) => {
		const stop = createSharingAdapter(asGuest).watchReceivedInvites(
			GUEST,
			(invites) => {
				stop();
				resolve(invites);
			},
		);
	});
	if (!received) throw new Error("the guest received no invitation");
	await createSharingAdapter(asGuest).acceptInvite(received);

	expect(await stored(EVENT)).toMatchObject({
		memberIds: [OWNER, GUEST],
		roles: { [GUEST]: "editor" },
	});
});

test.each(["event repository", "account deletion"])(
	"leaving through the %s writes the tombstone the rules accept",
	async (path) => {
		await env.withSecurityRulesDisabled(async (ctx) => {
			const db = ctx.firestore();
			const joined = {
				memberIds: [OWNER, GUEST],
				roles: { [GUEST]: "viewer" },
			};
			await setDoc(doc(db, EVENT), joined, { merge: true });
			await setDoc(doc(db, INVITE), { ...AN_INVITE, status: "accepted" });
		});
		const db = env
			.authenticatedContext(GUEST, { email_verified: true })
			.firestore() as unknown as Firestore;

		await (path === "event repository"
			? new FirebaseEventRepository(db).leave("an-event", GUEST)
			: createAccountDataAdapter(db, {} as FirebaseStorage).leaveEvent(
					"an-event",
					GUEST,
				));

		expect(await stored(EVENT)).toMatchObject({ memberIds: [OWNER] });
		expect(await stored(INVITE)).toMatchObject({
			status: "removed",
			invitedBy: OWNER,
		});
	},
);
