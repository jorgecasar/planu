import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../../application/ports/session.js";

/** Never dereferenced for real: every SDK call this adapter makes is mocked. */
const FAKE_FIRESTORE = {} as Firestore;

// Same pattern as `sharing/invitations.test.ts` and
// `infrastructure/firebase/event-repository.test.ts`: mock the SDK functions
// this module (and `sharing/invitations.ts`, which it calls straight
// through to for `inviteToEvent`/`revokeInvite`) calls, so
// `publishDirectoryEntry()`'s decisions are tested without an emulator.

const docMock = vi.fn((_db: unknown, collection: string, id: string) => ({
	path: `${collection}/${id}`,
}));
const setDocMock = vi.fn();

vi.mock("firebase/firestore", () => ({
	doc: docMock,
	setDoc: setDocMock,
	// Unused by the tests below, but this module imports from
	// `invitations.ts`, which imports these too — the mock replaces the whole
	// module, so every export either file needs at import time has to exist
	// here, even the ones these tests never call.
	arrayUnion: vi.fn(),
	collection: vi.fn(),
	deleteDoc: vi.fn(),
	getDoc: vi.fn(),
	getDocs: vi.fn(),
	query: vi.fn(),
	serverTimestamp: vi.fn(),
	updateDoc: vi.fn(),
	where: vi.fn(),
	writeBatch: vi.fn(),
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
