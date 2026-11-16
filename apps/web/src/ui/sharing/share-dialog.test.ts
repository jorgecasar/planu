import { afterEach, expect, test, vi } from "vitest";
import type { SessionUser } from "../../application/ports/session.js";
import type { DirectoryEntry } from "../../application/ports/sharing.js";
import type { StoredEvent } from "../../domain/event.js";
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
		listEmailOffers: vi.fn().mockResolvedValue([]),
		revokeEmailOffer: vi.fn().mockResolvedValue(undefined),
		inviteToEvent: vi.fn().mockResolvedValue(undefined),
		offerInviteByEmail: vi.fn().mockResolvedValue(undefined),
		updateEventMembership: vi.fn().mockResolvedValue(undefined),
		restoreAccessOffer: vi.fn().mockResolvedValue(undefined),
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

/** Picks `value` (never "remove", which now asks first) from the one guest's menu; resolves with the membership write. */
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
async function openWithGuest(
	sharing = fakeSharing(async () => null),
	roles: StoredEvent["roles"] = {},
) {
	const event = { ...EVENT, memberIds: [OWNER.uid, "bea-uid"], roles };
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

const click = (root: ShadowRoot | null | undefined, selector: string) =>
	root?.querySelector<HTMLElement>(selector)?.click();

/** Opens the dialog with Bea ("Bea") as the one guest and picks "Remove access". */
async function chooseRemove(
	sharing = fakeSharing(async () => null),
	roles: StoredEvent["roles"] = {},
) {
	sharing.findProfiles.mockResolvedValue(
		new Map([["bea-uid", { displayName: "Bea", photoURL: "" }]]),
	);
	const { el } = await openWithGuest(sharing, roles);
	const live = el.shadowRoot?.querySelector("[role=status].live");
	const detail = { item: { value: "remove" } };
	el.shadowRoot
		?.querySelector("wa-dropdown")
		?.dispatchEvent(new CustomEvent("wa-select", { detail }));
	await el.updateComplete;
	return { el, sharing, live };
}

test("choosing Remove access asks first, naming the person, and writes nothing (GH-189)", async () => {
	const { el, sharing } = await chooseRemove();
	const confirmation = el.shadowRoot?.querySelector(".confirm");

	expect(confirmation?.textContent).toContain("Bea");
	expect(sharing.updateEventMembership).not.toHaveBeenCalled();
});

test("cancelling the confirmation writes nothing and closes it (GH-189)", async () => {
	const { el, sharing } = await chooseRemove();
	click(el.shadowRoot, "[data-action=cancel-remove]");
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector(".confirm")).toBeNull();
	expect(sharing.updateEventMembership).not.toHaveBeenCalled();
});

test("confirming removes with the tombstone, then announces who, in a region that was already there (GH-147, GH-189)", async () => {
	const { el, sharing, live } = await chooseRemove();
	expect(live).not.toBeNull();
	expect(live?.textContent?.trim()).toBe("");

	click(el.shadowRoot, "[data-action=confirm-remove]");
	await vi.waitFor(() =>
		expect(sharing.updateEventMembership).toHaveBeenCalledTimes(1),
	);

	expect(sharing.updateEventMembership).toHaveBeenCalledWith(
		"event-1",
		{ memberIds: [OWNER.uid], roles: {} },
		"bea-uid",
	);
	await vi.waitFor(() =>
		expect(live?.textContent?.trim()).toBe(
			"Access removed for Bea. They are not notified.",
		),
	);
	expect(el.shadowRoot?.querySelector("[role=status].live")).toBe(live);
	expect(live?.textContent).not.toMatch(/restor/i);
});

test("a failed removal announces nothing and keeps the error (GH-189)", async () => {
	const { el, sharing, live } = await chooseRemove();
	sharing.updateEventMembership.mockRejectedValue(new Error("denied"));
	click(el.shadowRoot, "[data-action=confirm-remove]");
	await vi.waitFor(() => expect(el.shadowRoot?.innerHTML).toContain("alert"));
	expect(live?.textContent?.trim()).toBe("");
});

test("once the row is gone, focus moves to the list heading (GH-189)", async () => {
	const { el, sharing } = await chooseRemove();
	// The parent hands over the new snapshot once the write lands.
	sharing.updateEventMembership.mockImplementation(async () => {
		el.event = { ...EVENT, memberIds: [OWNER.uid] };
	});
	click(el.shadowRoot, "[data-action=confirm-remove]");

	await vi.waitFor(() =>
		expect(el.shadowRoot?.activeElement?.tagName).toBe("H3"),
	);
});

/** Removes Bea (an Editor) and resolves once «Invite again» is offered. */
async function removeEditor(sharing = fakeSharing(async () => null)) {
	const calls: string[] = [];
	// The email comes back from the write, and the snapshot reload follows it.
	sharing.updateEventMembership.mockImplementation(async () => {
		calls.push("update");
		return "bea@example.com";
	});
	sharing.restoreAccessOffer.mockImplementation(async () => {
		calls.push("restore");
	});
	const { el } = await chooseRemove(sharing, { "bea-uid": "editor" });
	click(el.shadowRoot, "[data-action=confirm-remove]");
	const again = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector<HTMLElement>(
			"[data-action=reinvite]",
		);
		if (!found) throw new Error("No action yet");
		return found;
	});
	// The snapshot after the write: the role is no longer on the event. Wait
	// for the focus move to settle so it cannot land on a later swap.
	el.event = { ...EVENT, memberIds: [OWNER.uid], roles: {} };
	await vi.waitFor(() =>
		expect(el.shadowRoot?.activeElement?.tagName).toBe("H3"),
	);
	return { el, sharing, calls, again };
}

test("«Invite again» re-offers with the role captured before the write and the email it returned (GH-320)", async () => {
	const { el, sharing, calls, again } = await removeEditor();
	again.click();

	await vi.waitFor(() =>
		expect(sharing.restoreAccessOffer).toHaveBeenCalledTimes(1),
	);
	expect(calls).toEqual(["update", "restore"]);
	expect(sharing.restoreAccessOffer).toHaveBeenCalledWith(
		"event-1",
		"bea-uid",
		"editor",
		{ invitedByName: "Ana", inviteeEmail: "bea@example.com" },
	);
	const live = el.shadowRoot?.querySelector("[role=status].live");
	await vi.waitFor(() =>
		expect(live?.textContent?.trim()).toBe("Invitation sent again."),
	);
	expect(live?.textContent).not.toMatch(/restor/i);
	expect(el.shadowRoot?.querySelector("[data-action=reinvite]")).toBeNull();
});

test("«Invite again» does not call the port when the event is full (GH-320)", async () => {
	const { el, sharing, again } = await removeEditor();
	el.event = {
		...EVENT,
		memberIds: [OWNER.uid, ...Array.from({ length: 20 }, (_, i) => `g${i}`)],
	};
	await el.updateComplete;
	again.click();

	await vi.waitFor(() => expect(el.shadowRoot?.innerHTML).toContain("alert"));
	expect(el.shadowRoot?.textContent).toContain(
		"This event has reached its limit of guests.",
	);
	expect(sharing.restoreAccessOffer).not.toHaveBeenCalled();
});

test("lists the email offers and withdraws one, then reloads (GH-192)", async () => {
	const sharing = fakeSharing(async () => null);
	sharing.listEmailOffers
		.mockResolvedValueOnce([
			{
				id: "event-1_h",
				eventId: "event-1",
				inviteeEmail: "old@example.com",
				role: "editor",
			},
		])
		.mockResolvedValue([]);
	const el = document.createElement("planu-share-dialog");
	Object.assign(el, { user: OWNER, sharing, event: EVENT, open: true });
	document.body.append(el);

	const button = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector<HTMLElement>(
			"[data-action=withdraw-offer]",
		);
		if (!found) throw new Error("No offer yet");
		return found;
	});
	expect(el.shadowRoot?.textContent).toContain("old@example.com");

	button.click();
	await vi.waitFor(() =>
		expect(sharing.revokeEmailOffer).toHaveBeenCalledWith("event-1_h"),
	);
	await vi.waitFor(() =>
		expect(el.shadowRoot?.querySelector("[data-action=withdraw-offer]")).toBe(
			null,
		),
	);
});

test("a failed «Invite again» shows the error and announces nothing (GH-320)", async () => {
	const { el, sharing, again } = await removeEditor();
	sharing.restoreAccessOffer.mockRejectedValue(new Error("no tombstone"));
	again.click();

	await vi.waitFor(() => expect(el.shadowRoot?.innerHTML).toContain("alert"));
	const live = el.shadowRoot?.querySelector("[role=status].live");
	expect(live?.textContent).not.toContain("sent again");
});

test("the offer to invite again is cleared by the next write and by reopening (GH-320)", async () => {
	const { el } = await removeEditor();
	expect(el.shadowRoot?.querySelector("[data-action=reinvite]")).not.toBeNull();

	el.open = false;
	await el.updateComplete;
	el.open = true;
	await vi.waitFor(() =>
		expect(el.shadowRoot?.querySelector("[data-action=reinvite]")).toBeNull(),
	);
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

function stubShare(share: unknown): void {
	Object.defineProperty(navigator, "share", {
		value: share,
		configurable: true,
	});
}

test("«Share» is only offered where the browser can share", async () => {
	stubShare(undefined);
	const el = await inviteAndGetDialog("bea@example.com");

	expect(action(el, "share")).toBeNull();
	expect(action(el, "copy")).not.toBeNull();
	Reflect.deleteProperty(navigator, "share");
});

test("«Share» hands the system sheet the title and the link, not the address", async () => {
	const share = vi.fn().mockResolvedValue(undefined);
	stubShare(share);
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "share")?.click();

	await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
	const [payload] = share.mock.calls[0] ?? [];
	expect(payload.url).toBe(LINK);
	expect(payload.title).toContain("Concert");
	expect(JSON.stringify(payload)).not.toContain("bea@example.com");
	Reflect.deleteProperty(navigator, "share");
});

test("dismissing the share sheet is neither an error nor a copy", async () => {
	const writeText = vi
		.spyOn(navigator.clipboard, "writeText")
		.mockResolvedValue();
	const share = vi.fn().mockRejectedValue(new DOMException("", "AbortError"));
	stubShare(share);
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "share")?.click();
	await vi.waitFor(() => expect(share).toHaveBeenCalled());
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("wa-callout[variant=danger]")).toBeNull();
	expect(writeText).not.toHaveBeenCalled();
	Reflect.deleteProperty(navigator, "share");
});

test("when sharing fails for another reason, the link is copied instead", async () => {
	const writeText = vi
		.spyOn(navigator.clipboard, "writeText")
		.mockResolvedValue();
	stubShare(vi.fn().mockRejectedValue(new Error("not allowed")));
	const el = await inviteAndGetDialog("bea@example.com");

	action(el, "share")?.click();

	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
	Reflect.deleteProperty(navigator, "share");
});
