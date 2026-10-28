import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../../application/ports/session.js";

/** Never dereferenced for real: every SDK call this adapter makes is mocked. */
const FAKE_FIRESTORE = {} as Firestore;

// Same pattern as `sharing/invitations.test.ts` and
// `infrastructure/firebase/event-repository.test.ts`: mock the SDK functions
// this module (and `sharing/invitations.ts`, which it calls straight
// through to for `inviteToEvent`/`revokeInvite`) calls, so
// `claimPendingInvitesByEmail()`'s decisions are tested without an emulator.
// `apps/web/rules/event-invites-by-email.test.ts` covers the rules side
// (what the server accepts); this covers what the client actually sends.

const getDocMock = vi.fn();
const docMock = vi.fn((_db: unknown, collection: string, id: string) => ({
	path: `${collection}/${id}`,
}));
const setDocMock = vi.fn();
const serverTimestampMock = vi.fn(() => "SERVER_TIMESTAMP");
const deleteMock = vi.fn();
const batchSetMock = vi.fn();
const commitMock = vi.fn().mockResolvedValue(undefined);
const writeBatchMock = vi.fn(() => ({
	delete: deleteMock,
	set: batchSetMock,
	commit: commitMock,
}));

vi.mock("firebase/firestore", () => ({
	doc: docMock,
	getDoc: getDocMock,
	setDoc: setDocMock,
	serverTimestamp: serverTimestampMock,
	writeBatch: writeBatchMock,
	// Unused by the tests below, but this module imports from
	// `invitations.ts`, which imports these too — the mock replaces the whole
	// module, so every export either file needs at import time has to exist
	// here, even the ones these tests never call.
	arrayUnion: vi.fn(),
	collection: vi.fn(),
	deleteDoc: vi.fn(),
	getDocs: vi.fn(),
	query: vi.fn(),
	updateDoc: vi.fn(),
	where: vi.fn(),
}));

const { createSharingAdapter } = await import("./sharing-adapter.js");

describe("publishDirectoryEntry()", () => {
	const VERIFIED_USER: SessionUser = {
		uid: "ana-uid",
		email: "ana@example.com",
		displayName: "Ana",
		photoURL: null,
		emailVerified: true,
		provider: "password",
	};

	const adapter = createSharingAdapter(FAKE_FIRESTORE);

	beforeEach(() => {
		docMock.mockClear();
		setDocMock.mockReset();
	});

	test("does nothing without a verified email", async () => {
		setDocMock.mockResolvedValue(undefined);

		await adapter.publishDirectoryEntry({
			...VERIFIED_USER,
			emailVerified: false,
		});

		expect(setDocMock).not.toHaveBeenCalled();
	});

	test("writes the directory entry and the public profile", async () => {
		setDocMock.mockResolvedValue(undefined);

		await adapter.publishDirectoryEntry(VERIFIED_USER);

		const { emailHash } = await import("../../sharing/user-directory.js");
		const hash = await emailHash(VERIFIED_USER.email as string);
		expect(setDocMock).toHaveBeenCalledTimes(2);
		expect(setDocMock).toHaveBeenCalledWith(
			{ path: `userDirectory/${hash}` },
			{ uid: VERIFIED_USER.uid, displayName: "Ana", photoURL: "" },
		);
		expect(setDocMock).toHaveBeenCalledWith(
			{ path: `userProfiles/${VERIFIED_USER.uid}` },
			{ displayName: "Ana", photoURL: "" },
		);
	});

	test("a failed write still rejects, for the caller to swallow", async () => {
		const offline = new Error("network request failed");
		setDocMock.mockRejectedValue(offline);

		await expect(adapter.publishDirectoryEntry(VERIFIED_USER)).rejects.toBe(
			offline,
		);
	});
});

describe("claimPendingInvitesByEmail()", () => {
	const VERIFIED_USER: SessionUser = {
		uid: "newcomer-uid",
		email: "newcomer@example.com",
		displayName: "Newcomer",
		photoURL: null,
		emailVerified: true,
		provider: "password",
	};

	const AN_OFFER = {
		eventTitle: "Concert",
		inviteeEmail: VERIFIED_USER.email,
		invitedBy: "owner-uid",
		invitedByName: "Ana",
		role: "viewer" as const,
	};

	const adapter = createSharingAdapter(FAKE_FIRESTORE);

	beforeEach(() => {
		getDocMock.mockReset();
		docMock.mockClear();
		writeBatchMock.mockClear();
		deleteMock.mockReset();
		batchSetMock.mockReset();
		commitMock.mockReset().mockResolvedValue(undefined);
	});

	test("does nothing without an email", async () => {
		await adapter.claimPendingInvitesByEmail({
			...VERIFIED_USER,
			email: null,
		});

		expect(getDocMock).not.toHaveBeenCalled();
	});

	test("does nothing when the email is not verified", async () => {
		await adapter.claimPendingInvitesByEmail(
			{ ...VERIFIED_USER, emailVerified: false },
			["an-event"],
		);

		expect(getDocMock).not.toHaveBeenCalled();
	});

	test("with no candidate events, does nothing — the documented state of both real call sites today", async () => {
		await adapter.claimPendingInvitesByEmail(VERIFIED_USER);

		expect(getDocMock).not.toHaveBeenCalled();
		expect(writeBatchMock).not.toHaveBeenCalled();
	});

	test("claims a pending offer that matches the caller's own email", async () => {
		getDocMock.mockResolvedValue({
			exists: () => true,
			data: () => AN_OFFER,
		});

		await adapter.claimPendingInvitesByEmail(VERIFIED_USER, ["an-event"]);

		const { emailHash } = await import("../../sharing/user-directory.js");
		const hash = await emailHash(VERIFIED_USER.email as string);
		// Looked up at the deterministic id, never anything a caller supplied.
		expect(docMock).toHaveBeenCalledWith(
			{},
			"eventInvitesByEmail",
			`an-event_${hash}`,
		);

		// Both halves of the batch: the offer is deleted, and a normal,
		// pending eventInvites entry is created for this uid.
		expect(deleteMock).toHaveBeenCalledWith({
			path: `eventInvitesByEmail/an-event_${hash}`,
		});
		expect(batchSetMock).toHaveBeenCalledWith(
			{ path: `eventInvites/an-event_${VERIFIED_USER.uid}` },
			{
				eventId: "an-event",
				eventTitle: "Concert",
				inviteeUid: VERIFIED_USER.uid,
				inviteeEmail: VERIFIED_USER.email,
				invitedBy: "owner-uid",
				invitedByName: "Ana",
				role: "viewer",
				status: "pending",
				createdAt: "SERVER_TIMESTAMP",
				decidedAt: null,
			},
		);
		expect(commitMock).toHaveBeenCalledTimes(1);
	});

	test("ignores a candidate event with no pending offer for this email", async () => {
		getDocMock.mockResolvedValue({
			exists: () => false,
			data: () => undefined,
		});

		await adapter.claimPendingInvitesByEmail(VERIFIED_USER, ["an-event"]);

		expect(writeBatchMock).not.toHaveBeenCalled();
	});

	test("ignores an offer whose stored email does not match the caller's own — belt and suspenders, not the real guard", async () => {
		// Cannot happen through the rules, which pin the id to a hash of the
		// stored inviteeEmail — this only guards against this function ever
		// being handed a document that violates that invariant some other way.
		getDocMock.mockResolvedValue({
			exists: () => true,
			data: () => ({ ...AN_OFFER, inviteeEmail: "someone-else@example.com" }),
		});

		await adapter.claimPendingInvitesByEmail(VERIFIED_USER, ["an-event"]);

		expect(writeBatchMock).not.toHaveBeenCalled();
	});

	test("claims only the candidates that actually have a matching offer", async () => {
		const { emailHash } = await import("../../sharing/user-directory.js");
		const hash = await emailHash(VERIFIED_USER.email as string);
		getDocMock.mockImplementation((ref: { path: string }) =>
			Promise.resolve(
				ref.path === `eventInvitesByEmail/event-with-offer_${hash}`
					? { exists: () => true, data: () => AN_OFFER }
					: { exists: () => false, data: () => undefined },
			),
		);

		await adapter.claimPendingInvitesByEmail(VERIFIED_USER, [
			"event-with-offer",
			"event-without-offer",
		]);

		expect(commitMock).toHaveBeenCalledTimes(1);
		expect(batchSetMock).toHaveBeenCalledWith(
			{ path: `eventInvites/event-with-offer_${VERIFIED_USER.uid}` },
			expect.objectContaining({ eventId: "event-with-offer" }),
		);
	});
});

describe("claimPendingInvitesByEmail() call sites", () => {
	test("is called only from the same two triggers as publishDirectoryEntry, and nowhere else", () => {
		// `node:fs` is not available here: this file runs under `npm test`'s
		// browser environment (real Chromium), unlike `arch/boundary.test.ts`,
		// which watches a similar invariant but runs under Node — see
		// `vitest.arch.config.ts`. `import.meta.glob` is Vite's build-time
		// equivalent: it reads the matched files' text at bundle time, so no
		// filesystem access happens in the browser at all.
		//
		// Looks for a **method call** (`.claimPendingInvitesByEmail(`), not a
		// bare identifier: since the `SharingPort` migration moved this behind a port, the
		// interface declaration and this adapter's own implementation both
		// write the name with no leading dot, so they don't match; only an
		// actual `sharing.claimPendingInvitesByEmail(...)` call does.
		const files = import.meta.glob("../../**/*.ts", {
			eager: true,
			query: "?raw",
			import: "default",
		}) as Record<string, string>;

		const callers = Object.entries(files)
			.filter(([path]) => !/sharing-adapter(\.test)?\.ts$/.test(path))
			.filter(([, content]) =>
				/\.claimPendingInvitesByEmail\s*\(/.test(content),
			)
			.map(([path]) => path)
			.sort();

		expect(callers).toEqual([
			"../../firebase/firebase-provider.ts",
			"../../profile/profile-view.ts",
		]);
	});
});
