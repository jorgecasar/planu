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
const deleteDocMock = vi.fn();

vi.mock("firebase/firestore", () => ({
	doc: docMock,
	setDoc: setDocMock,
	deleteDoc: deleteDocMock,
	serverTimestamp: () => "SERVER_TIME",
	// Unused by the tests below, but this module imports from
	// `invitations.ts`, which imports these too — the mock replaces the whole
	// module, so every export either file needs at import time has to exist
	// here, even the ones these tests never call.
	arrayUnion: vi.fn(),
	collection: vi.fn(),
	getDoc: vi.fn(),
	getDocs: vi.fn(),
	query: vi.fn(),
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

	const recordMock = vi.fn();
	const adapter = createSharingAdapter(FAKE_FIRESTORE, recordMock);

	beforeEach(() => {
		docMock.mockClear();
		setDocMock.mockReset();
		recordMock.mockClear();
	});

	test("does nothing without a verified email, and records nothing", async () => {
		setDocMock.mockResolvedValue(undefined);

		await adapter.publishDirectoryEntry({
			...VERIFIED_USER,
			emailVerified: false,
		});

		expect(setDocMock).not.toHaveBeenCalled();
		expect(recordMock).not.toHaveBeenCalled();
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
		const failed = new Error("quota exceeded");
		setDocMock.mockRejectedValue(failed);

		await expect(adapter.publishDirectoryEntry(VERIFIED_USER)).rejects.toBe(
			failed,
		);
	});

	test("records a write that throws before it is sent", async () => {
		const invalid = new Error("invalid data");
		setDocMock.mockImplementation(() => {
			throw invalid;
		});
		await expect(adapter.publishDirectoryEntry(VERIFIED_USER)).rejects.toBe(
			invalid,
		);
		expect(recordMock).toHaveBeenCalledWith(
			"publishDirectoryEntry",
			"failure",
			invalid,
		);
	});

	test("records a success, and a rule denial apart from other failures", async () => {
		setDocMock.mockResolvedValue(undefined);
		await adapter.publishDirectoryEntry(VERIFIED_USER);
		expect(recordMock).toHaveBeenLastCalledWith(
			"publishDirectoryEntry",
			"success",
		);

		const denied = Object.assign(new Error("denied"), {
			code: "permission-denied",
		});
		setDocMock.mockRejectedValue(denied);
		await adapter.publishDirectoryEntry(VERIFIED_USER).catch(() => {});
		expect(recordMock).toHaveBeenLastCalledWith(
			"publishDirectoryEntry",
			"permission-denied",
			denied,
		);
	});
});

describe("offerInviteByEmail()", () => {
	const adapter = createSharingAdapter(FAKE_FIRESTORE);
	const OFFER = {
		eventId: "e1",
		eventTitle: "Concert",
		inviteeEmail: " NewComer@Example.com",
		invitedBy: "owner-uid",
		invitedByName: "Ana",
		role: "viewer" as const,
	};

	beforeEach(() => {
		setDocMock.mockReset();
		deleteDocMock.mockReset();
	});

	async function offerPath() {
		const { emailHash } = await import("../../sharing/user-directory.js");
		return `eventInvitesByEmail/e1_${await emailHash("newcomer@example.com")}`;
	}

	test("writes the offer at its deterministic id, with a normalised email", async () => {
		setDocMock.mockResolvedValue(undefined);

		await adapter.offerInviteByEmail(OFFER);

		expect(setDocMock).toHaveBeenCalledExactlyOnceWith(
			{ path: await offerPath() },
			{
				...OFFER,
				inviteeEmail: "newcomer@example.com",
				createdAt: "SERVER_TIME",
			},
		);
		expect(deleteDocMock).not.toHaveBeenCalled();
	});

	test("re-offering replaces the existing offer: delete, then write again", async () => {
		setDocMock
			.mockRejectedValueOnce(new Error("permission-denied"))
			.mockResolvedValueOnce(undefined);
		deleteDocMock.mockResolvedValue(undefined);

		await adapter.offerInviteByEmail(OFFER);

		expect(deleteDocMock).toHaveBeenCalledExactlyOnceWith({
			path: await offerPath(),
		});
		expect(setDocMock).toHaveBeenCalledTimes(2);
	});

	test("with nothing to replace, the original failure stands", async () => {
		const denied = new Error("permission-denied");
		setDocMock.mockRejectedValue(denied);
		deleteDocMock.mockRejectedValue(new Error("not found"));

		await expect(adapter.offerInviteByEmail(OFFER)).rejects.toBe(denied);
		expect(setDocMock).toHaveBeenCalledTimes(1);
	});
});
