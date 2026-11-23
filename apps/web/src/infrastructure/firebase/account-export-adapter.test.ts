import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { emailHash } from "../firestore-schema/user-directory.js";

// The SDK is mocked, as in `account-data-adapter.test.ts`: no emulator.
type Snapshot = { id: string; data: () => Record<string, unknown> };
const answers = new Map<string, Snapshot[]>();
const documents = new Map<string, Record<string, unknown>>();
const snap = (path: string, data: Record<string, unknown> = {}): Snapshot => ({
	id: path.split("/").pop() as string,
	data: () => data,
});

const getDocs = vi.fn(async (key: string) => ({
	docs: answers.get(key) ?? [],
}));
const getDoc = vi.fn(async (ref: { path: string }) => ({
	data: () => documents.get(ref.path),
}));

vi.mock("firebase/firestore", () => ({
	collection: (_db: unknown, path: string) => path,
	where: (field: string, op: string, value: string) =>
		`${field} ${op} ${value}`,
	query: (path: string, constraint: string) => `${path}|${constraint}`,
	doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
	getDoc,
	getDocs,
}));

const { createAccountExportAdapter } = await import(
	"./account-export-adapter.js"
);

const HASH = await emailHash("ana@example.com");
const adapterFor = (email: string | null) =>
	createAccountExportAdapter({} as Firestore, () => email);

beforeEach(() => {
	answers.clear();
	documents.clear();
	vi.clearAllMocks();
});

describe("what the person can read about themselves", () => {
	test("reads their profile and directory entry, the latter by the hash of their email", async () => {
		documents.set("userProfiles/ana", { displayName: "Ana", photoURL: "p" });
		documents.set(`userDirectory/${HASH}`, {
			displayName: "Ana",
			photoURL: "d",
		});

		const out = await adapterFor("ana@example.com").read("ana");

		expect(out.profile).toEqual({ displayName: "Ana", photoURL: "p" });
		expect(out.directoryEntry).toEqual({ displayName: "Ana", photoURL: "d" });
	});

	test("lists events by memberIds and keeps the fields of the owned ones only", async () => {
		answers.set("events|memberIds array-contains ana", [
			snap("events/e1", { userId: "ana", title: "Mine" }),
			snap("events/e2", { userId: "luis", title: "Luis's" }),
		]);

		const { events } = await adapterFor(null).read("ana");

		expect(events).toEqual([
			{ id: "e1", isOwner: true, fields: { userId: "ana", title: "Mine" } },
			{ id: "e2", isOwner: false, fields: {} },
		]);
	});

	test("invitations come from the queries the rules allow, by uid and by the hash of the email", async () => {
		const data = { eventId: "e1", role: "viewer", invitedBy: "x" };
		const at = (key: string, path: string) =>
			answers.set(key, [snap(path, data)]);
		at("eventInvites|invitedBy == ana", "eventInvites/s1");
		at("eventInvitesByEmail|invitedBy == ana", "eventInvitesByEmail/s2");
		at("eventInvites|inviteeUid == ana", "eventInvites/r1");
		at(`eventInvitesByEmail|emailHash == ${HASH}`, "eventInvitesByEmail/r2");

		const out = await adapterFor("ana@example.com").read("ana");

		expect(out.sentInvites.map((i) => i.id)).toEqual(["s1", "s2"]);
		expect(out.receivedInvites.map((i) => i.id)).toEqual(["r1", "r2"]);
		expect(out.sentInvites[0]).toEqual({
			id: "s1",
			eventId: "e1",
			role: "viewer",
		});
	});

	test("without an email it never asks for the directory entry or the offers by hash", async () => {
		await adapterFor(null).read("ana");

		const asked = getDocs.mock.calls.map(([key]) => key);
		expect(asked.some((key) => String(key).includes("emailHash"))).toBe(false);
		expect(getDoc).toHaveBeenCalledTimes(1);
	});
});
