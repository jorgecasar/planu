import { beforeEach, describe, expect, test, vi } from "vitest";

// Same pattern as `infrastructure/firebase/event-repository.test.ts`: mock
// the SDK functions this module calls, so `inviteToEvent()`'s decision of
// what `createdAt` to send is tested without an emulator — the rules-side
// coverage in `apps/web/rules/event-invites.test.ts` can't reach this,
// because it can only assert against the `firebase/compat` type
// `@firebase/rules-unit-testing` hands back, not the modular client SDK
// `inviteToEvent()` is typed against.

const getDocMock = vi.fn();
const docMock = vi.fn((_db: unknown, collection: string, id: string) => ({
	path: `${collection}/${id}`,
}));
const serverTimestampMock = vi.fn(() => "SERVER_TIMESTAMP");
const setDocMock = vi.fn();

vi.mock("firebase/firestore", () => ({
	arrayUnion: vi.fn(),
	collection: vi.fn(),
	deleteDoc: vi.fn(),
	doc: docMock,
	getDoc: getDocMock,
	query: vi.fn(),
	serverTimestamp: serverTimestampMock,
	setDoc: setDocMock,
	updateDoc: vi.fn(),
	where: vi.fn(),
	writeBatch: vi.fn(),
}));

const { inviteToEvent } = await import("./invitations.js");

const AN_OFFER = {
	eventId: "an-event",
	eventTitle: "Concert",
	inviteeUid: "guest-uid",
	inviteeEmail: "guest@example.com",
	invitedBy: "owner-uid",
	invitedByName: "Ana",
	role: "viewer" as const,
};

describe("inviteToEvent()", () => {
	beforeEach(() => {
		getDocMock.mockReset();
		setDocMock.mockReset().mockResolvedValue(undefined);
	});

	test("with no prior invitation, sends a fresh server createdAt", async () => {
		getDocMock.mockResolvedValue({
			exists: () => false,
			data: () => undefined,
		});

		await inviteToEvent({} as never, AN_OFFER);

		const [, written] = setDocMock.mock.calls[0] as [
			unknown,
			{ createdAt: unknown },
		];
		expect(written.createdAt).toBe("SERVER_TIMESTAMP");
	});

	test("with a pending invitation already there, reuses its stored createdAt", async () => {
		// This is the case the fix targets: `ownerEditsWhilePending()` pins
		// `createdAt` to its stored value, so a fresh `serverTimestamp()` here
		// would deny every retry of inviting the same still-pending person —
		// which is exactly what re-submitting the invite form to fix a typo'd
		// role, or just resubmitting by accident, used to do.
		const storedCreatedAt = { seconds: 1700000000, nanoseconds: 0 };
		getDocMock.mockResolvedValue({
			exists: () => true,
			data: () => ({ status: "pending", createdAt: storedCreatedAt }),
		});

		await inviteToEvent({} as never, { ...AN_OFFER, role: "editor" });

		const [, written] = setDocMock.mock.calls[0] as [
			unknown,
			{ createdAt: unknown; role: string },
		];
		expect(written.createdAt).toBe(storedCreatedAt);
		expect(written.role).toBe("editor");
	});

	test("with a decided invitation (accepted or declined), sends a fresh createdAt", async () => {
		// Re-offering after a decision is `ownerReoffers()`'s job, which pins
		// `createdAt` to `request.time` too — reusing the old, spent date here
		// would misdate the new offer.
		for (const status of ["accepted", "declined"]) {
			getDocMock.mockResolvedValue({
				exists: () => true,
				data: () => ({ status, createdAt: { seconds: 1, nanoseconds: 0 } }),
			});
			setDocMock.mockClear();

			await inviteToEvent({} as never, AN_OFFER);

			const [, written] = setDocMock.mock.calls[0] as [
				unknown,
				{ createdAt: unknown },
			];
			expect(written.createdAt).toBe("SERVER_TIMESTAMP");
		}
	});

	test("always writes status pending and decidedAt null, regardless of what existed before", async () => {
		getDocMock.mockResolvedValue({
			exists: () => true,
			data: () => ({
				status: "accepted",
				createdAt: { seconds: 1, nanoseconds: 0 },
			}),
		});

		await inviteToEvent({} as never, AN_OFFER);

		const [, written] = setDocMock.mock.calls[0] as [
			unknown,
			{ status: string; decidedAt: unknown },
		];
		expect(written.status).toBe("pending");
		expect(written.decidedAt).toBeNull();
	});
});
