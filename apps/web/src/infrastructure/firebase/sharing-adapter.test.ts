import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../../application/ports/session.js";

/** Never dereferenced for real: every SDK call this adapter makes is mocked. */
const FAKE_FIRESTORE = {} as Firestore;

// Same pattern as `event-repository.test.ts`: mock the SDK functions this
// module calls, so its decisions are tested without an emulator.

const docMock = vi.fn((_db: unknown, collection: string, id: string) => ({
	path: `${collection}/${id}`,
}));
const setDocMock = vi.fn();
const deleteDocMock = vi.fn();
const getDocMock = vi.fn();
const updateDocMock = vi.fn();
const batchUpdateMock = vi.fn();
const batchSetMock = vi.fn();
const batchDeleteMock = vi.fn();
const commitMock = vi.fn();
const onSnapshotMock = vi.fn();
const getDocsMock = vi.fn();

vi.mock("firebase/firestore", () => ({
	doc: docMock,
	setDoc: setDocMock,
	deleteDoc: deleteDocMock,
	getDoc: getDocMock,
	updateDoc: updateDocMock,
	onSnapshot: onSnapshotMock,
	serverTimestamp: () => "SERVER_TIME",
	arrayUnion: (value: string) => ({ arrayUnion: value }),
	writeBatch: () => ({
		update: batchUpdateMock,
		set: batchSetMock,
		delete: batchDeleteMock,
		commit: commitMock,
	}),
	collection: (_db: unknown, path: string) => ({ path }),
	query: (from: unknown, ...clauses: unknown[]) => ({ from, clauses }),
	where: (...clause: unknown[]) => clause,
	getDocs: getDocsMock,
}));

const { createSharingAdapter } = await import("./sharing-adapter.js");
const directory = await import("../../sharing/user-directory.js");
const hashOf = () => directory.emailHash("guest@example.com");

/** The owner's offers for the event; the adapter picks the address's one. */
const offerQuery = (eventId: string) => ({
	from: { path: "eventInvitesByEmail" },
	clauses: [
		["invitedBy", "==", "owner-uid"],
		["eventId", "==", eventId],
	],
});

/** That event's offers: the guest's, behind a decoy to another address. */
async function offersOf(eventId: string) {
	const offer = { path: `eventInvitesByEmail/${eventId}_${await hashOf()}` };
	const decoy = { path: `eventInvitesByEmail/${eventId}_other` };
	const docs = [decoy, offer].map((ref) => ({
		id: ref.path.split("/")[1],
		ref,
	}));
	getDocsMock.mockResolvedValue({ docs });
	return offer;
}

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

describe("inviteToEvent()", () => {
	const adapter = createSharingAdapter(FAKE_FIRESTORE);
	const AN_OFFER = {
		eventId: "an-event",
		eventTitle: "Concert",
		inviteeUid: "guest-uid",
		inviteeEmail: "guest@example.com",
		invitedBy: "owner-uid",
		invitedByName: "Ana",
		role: "viewer" as const,
	};

	function existing(data?: Record<string, unknown>) {
		getDocMock.mockResolvedValue({ exists: () => !!data, data: () => data });
	}

	function written() {
		return batchSetMock.mock.calls[0]?.[1] as Record<string, unknown>;
	}

	beforeEach(() => {
		getDocMock.mockReset();
		batchSetMock.mockReset();
		batchDeleteMock.mockReset();
		commitMock.mockReset().mockResolvedValue(undefined);
		getDocsMock.mockReset().mockResolvedValue({ docs: [] });
	});

	test("spends the owner's email offer to that address in the same batch (GH-147)", async () => {
		existing();
		const offer = await offersOf("an-event");

		await adapter.inviteToEvent(AN_OFFER);

		expect(getDocsMock).toHaveBeenCalledExactlyOnceWith(offerQuery("an-event"));
		expect(batchDeleteMock).toHaveBeenCalledExactlyOnceWith(offer);
		expect(batchSetMock).toHaveBeenCalledOnce();
		expect(commitMock).toHaveBeenCalledOnce();
	});

	test("with no such offer, deletes nothing: a missing one would deny the batch", async () => {
		existing();
		await adapter.inviteToEvent(AN_OFFER);
		expect(batchDeleteMock).not.toHaveBeenCalled();
		expect(commitMock).toHaveBeenCalledOnce();
	});

	test("with a pending invitation already there, reuses its stored createdAt", async () => {
		// `ownerEditsWhilePending()` pins `createdAt`: a fresh one denies retries.
		const storedCreatedAt = { seconds: 1700000000, nanoseconds: 0 };
		existing({ status: "pending", createdAt: storedCreatedAt });

		await adapter.inviteToEvent({ ...AN_OFFER, role: "editor" });

		expect(written()["createdAt"]).toBe(storedCreatedAt);
		expect(written()["role"]).toBe("editor");
	});

	test("with none or a decided one, sends a fresh createdAt, pending and undecided", async () => {
		// `ownerReoffers()` pins `createdAt` to `request.time` here too.
		const spent = { seconds: 1, nanoseconds: 0 };
		for (const status of [undefined, "accepted", "declined"]) {
			existing(status ? { status, createdAt: spent } : undefined);
			batchSetMock.mockClear();

			await adapter.inviteToEvent(AN_OFFER);

			expect(written()).toMatchObject({
				createdAt: "SERVER_TIME",
				status: "pending",
				decidedAt: null,
			});
		}
	});
});

describe("acceptInvite()", () => {
	beforeEach(() => {
		batchUpdateMock.mockReset();
		commitMock.mockReset().mockResolvedValue(undefined);
	});

	test("joins the event and marks the invitation accepted in one batch", async () => {
		await createSharingAdapter(FAKE_FIRESTORE).acceptInvite({
			id: "e1_guest",
			eventId: "e1",
			eventTitle: "Concert",
			inviteeUid: "guest",
			invitedByName: "Ana",
			role: "editor",
		});

		expect(batchUpdateMock.mock.calls).toEqual([
			[
				{ path: "events/e1" },
				{ memberIds: { arrayUnion: "guest" }, "roles.guest": "editor" },
			],
			[
				{ path: "eventInvites/e1_guest" },
				{ status: "accepted", decidedAt: "SERVER_TIME" },
			],
		]);
		expect(commitMock).toHaveBeenCalledOnce();
		const lastUpdate = Math.max(...batchUpdateMock.mock.invocationCallOrder);
		expect(commitMock.mock.invocationCallOrder[0]).toBeGreaterThan(lastUpdate);
	});

	test("spends the invitee's own email offer when there is one (GH-147)", async () => {
		const offer = { path: `eventInvitesByEmail/e1_${await hashOf()}` };
		const invite = {
			id: "e1_guest",
			eventId: "e1",
			eventTitle: "Concert",
			inviteeUid: "guest",
			invitedByName: "Ana",
			role: "viewer" as const,
		};
		const adapter = createSharingAdapter(FAKE_FIRESTORE);
		for (const exists of [true, false]) {
			getDocMock
				.mockReset()
				.mockResolvedValue({ exists: () => exists, ref: offer });
			batchDeleteMock.mockReset();
			await adapter.acceptInvite(invite, " Guest@Example.com");
			expect(getDocMock).toHaveBeenCalledExactlyOnceWith(offer);
			expect(batchDeleteMock.mock.calls).toEqual(exists ? [[offer]] : []);
		}
	});
});

describe("declineInvite()", () => {
	test("marks it declined and keeps the record", async () => {
		updateDocMock.mockReset().mockResolvedValue(undefined);

		await createSharingAdapter(FAKE_FIRESTORE).declineInvite("e1_guest");

		expect(updateDocMock).toHaveBeenCalledExactlyOnceWith(
			{ path: "eventInvites/e1_guest" },
			{ status: "declined", decidedAt: "SERVER_TIME" },
		);
	});
});

describe("watchReceivedInvites()", () => {
	test("listens to the user's pending invitations and maps each row", () => {
		const unsubscribe = () => {};
		onSnapshotMock.mockReset().mockReturnValue(unsubscribe);
		const onChange = vi.fn();
		const adapter = createSharingAdapter(FAKE_FIRESTORE);

		expect(adapter.watchReceivedInvites("guest", onChange)).toBe(unsubscribe);
		const [listened, onNext] = onSnapshotMock.mock.calls[0] as [
			unknown,
			(snapshot: unknown) => void,
		];
		expect(listened).toEqual({
			from: { path: "eventInvites" },
			clauses: [
				["inviteeUid", "==", "guest"],
				["status", "==", "pending"],
			],
		});

		const row = (id: string, data: object) => ({ id, data: () => data });
		const e1 = {
			eventId: "e1",
			eventTitle: "Concert",
			inviteeUid: "guest",
			invitedByName: "Ana",
			role: "editor",
		};
		onNext({ docs: [row("e1_guest", e1), row("e2_guest", { role: "owner" })] });

		expect(onChange).toHaveBeenCalledExactlyOnceWith([
			{ id: "e1_guest", ...e1 },
			{
				id: "e2_guest",
				eventId: "",
				eventTitle: "",
				inviteeUid: "",
				invitedByName: "",
				role: "viewer",
			},
		]);
	});
});
