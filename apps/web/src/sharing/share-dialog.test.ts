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

const ROLE_HELP =
	"Viewer: can see the event. Editor: can also change its details. Neither can invite, remove people or delete the event.";

test("the role selector is described by one line naming both roles (GH-270)", async () => {
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, {
		user: OWNER,
		sharing: fakeSharing(async () => null),
		event: EVENT,
		open: true,
	});
	document.body.append(el);
	const select = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector<
			HTMLElement & { hint: string; updateComplete: Promise<unknown> }
		>("wa-select[name=role]");
		if (!found) throw new Error("No role selector yet");
		return found;
	});
	await select.updateComplete;

	expect(select.hint).toBe(ROLE_HELP);
	// The select wires the hint to its own control; the line is not a loose paragraph.
	const hint = select.shadowRoot?.querySelector("[part~=hint]");
	expect(hint?.textContent).toContain("Viewer");
	expect(hint?.textContent).toContain("Editor");
	const describedBy = select.shadowRoot
		?.querySelector("[aria-describedby]")
		?.getAttribute("aria-describedby");
	expect(describedBy).toBeTruthy();
	expect(select.shadowRoot?.getElementById(describedBy ?? "")).toBe(hint);
});

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

/** Opens the dialog on `event` and resolves once its guest row is drawn. */
async function openWithGuest(sharing = fakeSharing(async () => null)) {
	const event = { ...EVENT, memberIds: [OWNER.uid, "bea-uid"] };
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event, open: true });
	document.body.append(el);
	const trigger = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector<
			HTMLElement & { updateComplete: Promise<unknown> }
		>("wa-dropdown [slot=trigger]");
		if (!found) throw new Error("No guest yet");
		return found;
	});
	await trigger.updateComplete;
	return { el, sharing, trigger };
}

test("the guest rows take the dialog's own row styles", async () => {
	const { el } = await openWithGuest();
	const style = (selector: string) =>
		getComputedStyle(el.shadowRoot?.querySelector(selector) as Element);

	expect(style(".wa-visually-hidden").position).toBe("absolute");
	expect(style("ul").listStyleType).toBe("none");
});

test("a guest's menu is locked while a change is being saved", async () => {
	const sharing = fakeSharing(async () => null);
	sharing.updateEventMembership.mockReturnValue(new Promise(() => {}));
	const { el, trigger } = await openWithGuest(sharing);

	const detail = { item: { value: "editor" } };
	el.shadowRoot
		?.querySelector("wa-dropdown")
		?.dispatchEvent(new CustomEvent("wa-select", { detail }));

	await vi.waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(true));
});

test("handing over another event clears the list while it reloads", async () => {
	const { el, sharing } = await openWithGuest();
	sharing.listPendingInvites.mockReturnValue(new Promise(() => {}));

	el.event = { ...EVENT, id: "event-2" };
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("wa-dropdown")).toBeNull();
	expect(el.shadowRoot?.querySelector(".empty")?.textContent).toBe("Loading…");
});

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

// Every card mounts a closed dialog: its form must not sit in the page.
test("a closed dialog keeps its form out of the DOM until it opens", async () => {
	const sharing = fakeSharing(async () => null);
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event: EVENT, open: false });
	document.body.append(el);
	await el.updateComplete;
	expect(el.shadowRoot?.querySelector("wa-dialog")).not.toBeNull();
	expect(el.shadowRoot?.querySelector("form")).toBeNull();

	el.open = true;
	await el.updateComplete;
	const email = el.shadowRoot?.querySelector("wa-input[name=email]");
	expect(email?.getAttribute("autocomplete")).toBe("off");
});

test("closing before the dialog finished showing still unmounts the body", async () => {
	const sharing = fakeSharing(async () => null);
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event: EVENT, open: false });
	document.body.append(el);
	await el.updateComplete;
	el.open = true;
	await el.updateComplete;
	el.open = false;
	await el.updateComplete;
	await vi.waitFor(() =>
		expect(el.shadowRoot?.querySelector("form")).toBeNull(),
	);
});
test("the body leaves once the dialog itself finishes hiding", async () => {
	const { el } = await openWithGuest();
	const dialog = el.shadowRoot?.querySelector("wa-dialog");
	const menu = el.shadowRoot?.querySelector("wa-dropdown");

	// A nested popup closing is not the dialog closing.
	menu?.dispatchEvent(new Event("wa-after-hide", { bubbles: true }));
	await el.updateComplete;
	expect(el.shadowRoot?.querySelector("form")).not.toBeNull();

	el.open = false;
	dialog?.dispatchEvent(new Event("wa-after-hide"));
	await el.updateComplete;
	expect(el.shadowRoot?.querySelector("form")).toBeNull();
});

type Popup = HTMLElement & {
	value: string;
	open: boolean;
	updateComplete: Promise<unknown>;
};

// Web Awesome's `wa-hide` and `wa-after-hide` bubble and are composed: a
// nested popup closing used to close the whole dialog.
test("closing the role select or a guest's menu keeps the dialog and its draft", async () => {
	const { el } = await openWithGuest();
	const closed = vi.fn();
	el.addEventListener("planu-share-close", closed);
	const root = el.shadowRoot as ShadowRoot;
	const email = root.querySelector("wa-input[name=email]") as Popup;
	const role = root.querySelector("wa-select[name=role]") as Popup;
	email.value = "bea@example.com";
	role.value = "editor";
	await Promise.all([email.updateComplete, role.updateComplete]);

	const hidden = (popup: Popup, type: string) =>
		new Promise((resolve) =>
			popup.addEventListener(type, resolve, { once: true }),
		);
	const menu = root.querySelector("wa-dropdown") as unknown as Popup;
	for (const popup of [role, menu]) {
		const shown = hidden(popup, "wa-after-show");
		popup.open = true;
		await shown;
		const after = hidden(popup, "wa-after-hide");
		popup.open = false;
		await after;
		await el.updateComplete;
	}

	expect(closed).not.toHaveBeenCalled();
	expect(el.open).toBe(true);
	expect(
		(root.querySelector("wa-dialog") as HTMLElement & { open: boolean }).open,
	).toBe(true);
	expect((root.querySelector("wa-input[name=email]") as Popup).value).toBe(
		"bea@example.com",
	);
	expect((root.querySelector("wa-select[name=role]") as Popup).value).toBe(
		"editor",
	);
});

test("the role select closing during the fade-out keeps the form until the dialog's own end", async () => {
	const { el } = await openWithGuest();
	const root = el.shadowRoot as ShadowRoot;
	const dialog = root.querySelector("wa-dialog") as HTMLElement;
	const role = root.querySelector("wa-select[name=role]") as Popup;
	// What is on the page when the dialog itself finishes hiding.
	let formAtDialogEnd: Element | null | undefined;
	const dialogEnd = new Promise<void>((resolve) => {
		dialog.addEventListener("wa-after-hide", (domEvent) => {
			if (domEvent.target !== dialog) return;
			formAtDialogEnd = root.querySelector("form");
			resolve();
		});
	});
	el.open = false;
	await el.updateComplete;
	// The select finishing its own hide mid-fade, the way Web Awesome sends
	// it: bubbling and composed. Its hide outlasts the dialog's in a real
	// browser here, so the order is pinned by hand.
	role.dispatchEvent(
		new Event("wa-after-hide", { bubbles: true, composed: true }),
	);
	await el.updateComplete;
	expect(root.querySelector("form")).not.toBeNull();
	await dialogEnd;

	expect(formAtDialogEnd).not.toBeNull();
	await el.updateComplete;
	expect(root.querySelector("form")).toBeNull();
});

/** Invites `email`, waits for the success notice and returns the dialog. */
async function inviteAndGetDialog(email: string) {
	const sharing = fakeSharing(async () => null);
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event: EVENT, open: true });
	document.body.append(el);
	await vi.waitFor(() => expect(sharing.listPendingInvites).toHaveBeenCalled());

	const input = el.shadowRoot?.querySelector<
		HTMLInputElement & { updateComplete: Promise<unknown> }
	>("[name=email]");
	if (!input) throw new Error("No email field");
	input.value = email;
	await input.updateComplete;
	el.shadowRoot?.querySelector("form")?.requestSubmit();
	await vi.waitFor(() => {
		if (!el.shadowRoot?.querySelector("wa-callout[variant=success]")) {
			throw new Error("No outcome yet");
		}
	});
	return el;
}

const action = (el: Element, name: string) =>
	el.shadowRoot?.querySelector<HTMLElement>(`[data-action=${name}]`);

const LINK = `${location.origin}/app/login?invite=event-1`;

afterEach(() => {
	vi.restoreAllMocks();
});

test("«Send by email» opens a mailto to that address, with the link and not the address in it", async () => {
	const el = await inviteAndGetDialog("bea@example.com");

	const href = action(el, "email")?.getAttribute("href") ?? "";
	expect(href.startsWith("mailto:bea%40example.com?subject=")).toBe(true);
	const body = new URL(href).searchParams.get("body") ?? "";
	expect(body).toContain(LINK);
	expect(body).not.toContain("bea@example.com");
});

test("no sharing actions are offered when the invitation failed", async () => {
	const sharing = fakeSharing(async () => null);
	sharing.offerInviteByEmail.mockRejectedValue(new Error("denied"));
	await invite(sharing, "bea@example.com");

	const el = document.querySelector("planu-share-dialog");
	expect(el?.shadowRoot?.querySelector("[data-action]")).toBeNull();
});

test("«Copy link» writes the link to the clipboard", async () => {
	const writeText = vi
		.spyOn(navigator.clipboard, "writeText")
		.mockResolvedValue();
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "copy")?.click();

	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
	await vi.waitFor(() =>
		expect(el.shadowRoot?.textContent).toContain("Link copied."),
	);
});

test("a clipboard that refuses is reported, not shown as copied", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("no"));
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "copy")?.click();

	await vi.waitFor(() =>
		expect(el.shadowRoot?.textContent).toContain("could not be copied"),
	);
	expect(el.shadowRoot?.textContent).not.toContain("Link copied.");
});

test("a copy that fails after one that worked no longer says «copied»", async () => {
	const writeText = vi
		.spyOn(navigator.clipboard, "writeText")
		.mockResolvedValueOnce()
		.mockRejectedValueOnce(new Error("no"));
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "copy")?.click();
	await vi.waitFor(() =>
		expect(el.shadowRoot?.textContent).toContain("Link copied."),
	);
	action(el, "copy")?.click();

	await vi.waitFor(() =>
		expect(el.shadowRoot?.textContent).toContain("could not be copied"),
	);
	expect(writeText).toHaveBeenCalledTimes(2);
	expect(el.shadowRoot?.textContent).not.toContain("Link copied.");
});
