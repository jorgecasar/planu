import { afterEach, expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import type { DirectoryEntry } from "../application/ports/sharing.js";
import type { StoredEvent } from "../lib/types.js";
import "./share-dialog.js";

const OWNER = {
	uid: "owner-uid",
	email: "owner@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: true,
	provider: "password",
} satisfies SessionUser;

const EVENT = {
	id: "event-1",
	title: "Concert",
	userId: OWNER.uid,
	memberIds: [OWNER.uid],
	roles: {},
	allDay: true,
	tags: [],
} as unknown as StoredEvent;

const SENT = "Invitation sent. They join once they accept it.";

function fakeSharing(found: () => Promise<DirectoryEntry | null>) {
	return {
		findUserByEmail: vi.fn(found),
		findProfiles: vi.fn().mockResolvedValue(new Map()),
		listPendingInvites: vi.fn().mockResolvedValue([]),
		inviteToEvent: vi.fn().mockResolvedValue(undefined),
		offerInviteByEmail: vi.fn().mockResolvedValue(undefined),
		updateEventMembership: vi.fn().mockResolvedValue(undefined),
	};
}

afterEach(() => {
	document.body.replaceChildren();
});

/** Mounts the open dialog, invites `email` and returns the callout shown. */
async function invite(
	sharing: ReturnType<typeof fakeSharing>,
	email: string,
	event = EVENT,
) {
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event, open: true });
	document.body.append(el);
	await vi.waitFor(() => expect(sharing.listPendingInvites).toHaveBeenCalled());

	const input = el.shadowRoot?.querySelector<
		HTMLInputElement & { updateComplete: Promise<unknown> }
	>("[name=email]");
	if (!input) throw new Error("No email field");
	input.value = email;
	await input.updateComplete;
	el.shadowRoot?.querySelector("form")?.requestSubmit();

	return vi.waitFor(() => {
		const callout = el.shadowRoot?.querySelector(
			"wa-callout[variant=success], wa-callout[variant=danger]",
		);
		if (!callout) throw new Error("No outcome yet");
		return callout.textContent?.trim();
	});
}

test("an address with an account is invited by uid", async () => {
	const bea = { uid: "bea-uid", displayName: "", photoURL: "" };
	const sharing = fakeSharing(async () => bea);

	expect(await invite(sharing, "bea@example.com")).toBe(SENT);
	expect(sharing.inviteToEvent).toHaveBeenCalledWith(
		expect.objectContaining({ inviteeUid: "bea-uid" }),
	);
	expect(sharing.offerInviteByEmail).not.toHaveBeenCalled();
});

/** Picks `value` from the one guest's menu; resolves with the membership write. */
async function pickForGuest(value: string) {
	const sharing = fakeSharing(async () => null);
	const event = {
		...EVENT,
		memberIds: [OWNER.uid, "bea-uid"],
		roles: { "bea-uid": "viewer" },
	};
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event, open: true });
	document.body.append(el);

	const menu = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector("wa-dropdown");
		if (!found) throw new Error("No guest yet");
		return found;
	});
	const detail = { item: { value } };
	menu.dispatchEvent(new CustomEvent("wa-select", { detail }));

	return vi.waitFor(() => {
		const [call] = sharing.updateEventMembership.mock.calls;
		if (!call) throw new Error("Not written yet");
		return call;
	});
}

test("removing a guest names them, so their email offer goes too (GH-147)", async () => {
	expect(await pickForGuest("remove")).toEqual([
		"event-1",
		{ memberIds: [OWNER.uid], roles: {} },
		"bea-uid",
	]);
});

test("changing a guest's role names nobody as removed", async () => {
	const [, membership, removed] = await pickForGuest("editor");
	expect(membership).toEqual({
		memberIds: [OWNER.uid, "bea-uid"],
		roles: { "bea-uid": "editor" },
	});
	expect(removed).toBeUndefined();
});

test("an address with no account is offered by email, with the same notice", async () => {
	const sharing = fakeSharing(async () => null);

	expect(await invite(sharing, "nadie@example.com")).toBe(SENT);
	expect(sharing.offerInviteByEmail).toHaveBeenCalledWith({
		eventId: EVENT.id,
		eventTitle: EVENT.title,
		inviteeEmail: "nadie@example.com",
		invitedBy: OWNER.uid,
		invitedByName: "Ana",
		role: "viewer",
	});
	expect(sharing.inviteToEvent).not.toHaveBeenCalled();
});

test("the owner's own address is refused", async () => {
	const ana = { uid: OWNER.uid, displayName: "Ana", photoURL: "" };
	const sharing = fakeSharing(async () => ana);

	expect(await invite(sharing, OWNER.email)).toContain(
		"You already own this event",
	);
	expect(sharing.inviteToEvent).not.toHaveBeenCalled();
	expect(sharing.offerInviteByEmail).not.toHaveBeenCalled();
});

test("someone already in the event is refused", async () => {
	const bea = { uid: "bea-uid", displayName: "", photoURL: "" };
	const sharing = fakeSharing(async () => bea);
	const shared = { ...EVENT, memberIds: [OWNER.uid, bea.uid] };

	expect(await invite(sharing, "bea@example.com", shared)).toContain(
		"already in this event",
	);
	expect(sharing.inviteToEvent).not.toHaveBeenCalled();
	expect(sharing.offerInviteByEmail).not.toHaveBeenCalled();
});

test("a failed lookup is not taken for an address with no account", async () => {
	const sharing = fakeSharing(async () => {
		throw new Error("offline");
	});

	expect(await invite(sharing, "x@example.com")).not.toBe(SENT);
	expect(sharing.offerInviteByEmail).not.toHaveBeenCalled();
	expect(sharing.inviteToEvent).not.toHaveBeenCalled();
});
