import { expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import type {
	PublicProfile,
	SharingPort,
} from "../application/ports/sharing.js";
import type { StoredEvent } from "../lib/types.js";
import { AccessList, toPeople } from "./access-list.js";

const EVENT = {
	id: "event-1",
	userId: "owner-uid",
	roles: { "bea-uid": "editor" },
} as unknown as StoredEvent;

const INVITE = {
	id: "invite-1",
	eventId: EVENT.id,
	inviteeUid: "dan-uid",
	inviteeEmail: "dan@example.com",
	role: "editor",
} as const;

const PROFILES = new Map<string, PublicProfile>([
	["bea-uid", { displayName: "Bea", photoURL: "bea.png" }],
	["dan-uid", { displayName: "", photoURL: "dan.png" }],
]);

/** One row as `[key, uid, role, name, email, photoURL, pending]`. */
const row = (person: ReturnType<typeof toPeople>[number]) => [
	person.key,
	person.uid,
	person.role,
	person.name,
	person.email,
	person.photoURL,
	person.pending,
];

test("members come first, by name, without their address", () => {
	const people = toPeople(EVENT, ["bea-uid", "carl-uid"], [], PROFILES);

	expect(people.map(row)).toEqual([
		["bea-uid", "bea-uid", "editor", "Bea", "", "bea.png", false],
		["carl-uid", "carl-uid", "viewer", "Guest", "", "", false],
	]);
});

test("a pending offer is keyed by invitation and shows the typed address", () => {
	const people = toPeople(EVENT, ["carl-uid"], [INVITE], PROFILES);

	expect(people.map(row)).toEqual([
		["carl-uid", "carl-uid", "viewer", "Guest", "", "", false],
		[
			"invite-1",
			"dan-uid",
			"editor",
			"Guest",
			"dan@example.com",
			"dan.png",
			true,
		],
	]);
});

/** A controller over `pending` for the invitation query, and its host. */
function controller(pending: () => Promise<unknown[]>, connected = true) {
	const sharing = {
		listPendingInvites: vi.fn(pending),
		findProfiles: vi.fn().mockResolvedValue(PROFILES),
	};
	const host = { requestUpdate: vi.fn() };
	const event = { ...EVENT, memberIds: ["owner-uid", "bea-uid"] };
	const access = new AccessList(host, {
		getSharing: () =>
			connected ? (sharing as unknown as SharingPort) : undefined,
		getEvent: () => event,
		getUser: () => ({ uid: "owner-uid" }) as SessionUser,
	});
	access.reset();
	return { access, host, sharing };
}

test("reset empties the list, shows it loading and repaints", () => {
	const { access, host } = controller(async () => []);
	access.people = [{ pending: true } as never];
	access.incomplete = true;
	host.requestUpdate.mockClear();

	access.reset();

	expect([access.people, access.loading, access.incomplete]).toEqual([
		[],
		true,
		false,
	]);
	expect(host.requestUpdate).toHaveBeenCalledOnce();
});

test("load lists the guests, not the owner, and repaints twice", async () => {
	const { access, host, sharing } = controller(async () => [INVITE]);
	host.requestUpdate.mockClear();

	await access.load();

	expect(sharing.listPendingInvites).toHaveBeenCalledWith(
		"event-1",
		"owner-uid",
	);
	expect(sharing.findProfiles).toHaveBeenCalledWith(["bea-uid", "dan-uid"]);
	expect(access.people.map((person) => person.key)).toEqual([
		"bea-uid",
		"invite-1",
	]);
	expect([access.loading, access.incomplete]).toEqual([false, false]);
	expect(host.requestUpdate).toHaveBeenCalledTimes(2);
});

test("a failed pending query keeps the members and flags the list", async () => {
	const { access } = controller(() => Promise.reject(new Error("offline")));

	await access.load();

	expect(access.incomplete).toBe(true);
	expect(access.people.map((person) => person.key)).toEqual(["bea-uid"]);
});

test("without the contexts it stops loading instead of hanging", async () => {
	const { access, host, sharing } = controller(async () => [], false);
	host.requestUpdate.mockClear();

	await access.load();

	expect(sharing.listPendingInvites).not.toHaveBeenCalled();
	expect(access.loading).toBe(false);
	expect(host.requestUpdate).toHaveBeenCalledOnce();
});
