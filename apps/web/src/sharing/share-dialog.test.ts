import { beforeEach, expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import type { SharingPort } from "../application/ports/sharing.js";
import type { StoredEvent } from "../lib/types.js";
import "./share-dialog.js";
import type { PlanuShareDialog } from "./share-dialog.js";

/**
 * `#onInvite` reaches `findUserByEmail`/`findProfiles`/`inviteToEvent`/
 * `offerInviteByEmail` through the `SharingPort` it `@consume`s, and
 * `#load()`/`#cancelInvite()` reach `listPendingInvites`/`revokeInvite` the
 * same way — a plain object satisfying the interface, set directly on the
 * element like `user` below, rather than mocking a module. Since the `SharingPort`
 * migration moved this behind a port, `share-dialog.ts` no longer reaches `firebase/firestore`
 * or `./user-directory.js`/`./invitations.js` directly, so a static
 * `import "./share-dialog.js"` works fine — no dynamic-import workaround
 * needed any more.
 *
 * What T64 actually decides — which collection gets written, and with
 * what — is tested without an emulator this way.
 * `apps/web/rules/event-invites-by-email.test.ts` covers what the server
 * accepts; this covers what the client sends and what it tells the owner.
 */
const findUserByEmailMock = vi.fn();
const findProfilesMock = vi.fn().mockResolvedValue(new Map());
const offerInviteByEmailMock = vi.fn().mockResolvedValue(undefined);
const inviteToEventMock = vi.fn().mockResolvedValue(undefined);
const revokeInviteMock = vi.fn();
const changeInviteRoleMock = vi.fn();
const updateEventMembershipMock = vi.fn();
/**
 * `#load()`'s reload of the pending list — resolved to empty by default.
 * These tests are about what `#onInvite` decides to write, not about the
 * pending list it reloads afterwards, so the shape of what comes back barely
 * matters as long as it does not reject.
 */
const listPendingInvitesMock = vi.fn().mockResolvedValue([]);

function fakeSharing(): SharingPort {
	return {
		findUserByEmail: findUserByEmailMock,
		findProfiles: findProfilesMock,
		listPendingInvites: listPendingInvitesMock,
		inviteToEvent: inviteToEventMock,
		offerInviteByEmail: offerInviteByEmailMock,
		changeInviteRole: changeInviteRoleMock,
		revokeInvite: revokeInviteMock,
		updateEventMembership: updateEventMembershipMock,
		publishDirectoryEntry: vi.fn(),
		claimPendingInvitesByEmail: vi.fn(),
	};
}

const OWNER: SessionUser = {
	uid: "owner-uid",
	email: "owner@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

const anEvent = (extra: Partial<StoredEvent> = {}): StoredEvent => ({
	id: "event-1",
	title: "Concert",
	description: "",
	location: "",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: OWNER.uid,
	memberIds: [OWNER.uid],
	allDay: true,
	tags: [],
	roles: {},
	...extra,
});

/**
 * Waits out `#load()`'s async chain, the same way `profile-view.test.ts`
 * waits out `#onCheck`'s: polling the component's own flag rather than a
 * fixed delay.
 */
async function settleLoad(el: PlanuShareDialog): Promise<void> {
	await vi.waitFor(
		() => {
			if ((el as unknown as { loading: boolean }).loading) {
				throw new Error("still loading");
			}
		},
		{ timeout: 2000, interval: 10 },
	);
	await el.updateComplete;
}

/** Same idea, for `#onInvite`'s own async chain. */
async function settleInvite(el: PlanuShareDialog): Promise<void> {
	await vi.waitFor(
		() => {
			if ((el as unknown as { busy: boolean }).busy) {
				throw new Error("still busy");
			}
		},
		{ timeout: 2000, interval: 10 },
	);
	await el.updateComplete;
}

/**
 * Mounted with no `<planu-firebase-provider>` ancestor, same pattern as
 * `app-shell.test.ts` and `profile-view.test.ts`: `@consume` never resolves
 * on its own here, so `user` and `sharing` are set directly, bypassing
 * the context.
 */
async function mount(event: StoredEvent): Promise<PlanuShareDialog> {
	const el = document.createElement("planu-share-dialog") as PlanuShareDialog;
	(el as unknown as { user: SessionUser }).user = OWNER;
	(el as unknown as { sharing: SharingPort }).sharing = fakeSharing();
	el.event = event;
	document.body.append(el);
	el.open = true;
	await el.updateComplete;
	await settleLoad(el);
	return el;
}

function field(el: PlanuShareDialog, name: string): HTMLInputElement {
	const found = el.shadowRoot?.querySelector<HTMLInputElement>(
		`[name="${name}"]`,
	);
	if (!found) throw new Error(`Field "${name}" is not in the DOM`);
	return found;
}

/**
 * Writes a `wa-input`'s `.value` and waits for it to propagate to the
 * `ElementInternals` backing `FormData` — same helper as
 * `event-editor.test.ts`'s `setField`, `#onInvite` reads the form the same
 * way `#onSave` does there.
 */
async function fillEmail(el: PlanuShareDialog, value: string): Promise<void> {
	const input = field(el, "email");
	input.value = value;
	await (input as unknown as { updateComplete?: Promise<unknown> })
		.updateComplete;
	await el.updateComplete;
}

async function invite(el: PlanuShareDialog, email: string): Promise<void> {
	await fillEmail(el, email);
	const form = el.shadowRoot?.querySelector("form") as HTMLFormElement;
	form.requestSubmit();
	await settleInvite(el);
}

function notice(el: PlanuShareDialog): string {
	return (
		el.shadowRoot
			?.querySelector('wa-callout[variant="success"]')
			?.textContent?.trim() ?? ""
	);
}

function error(el: PlanuShareDialog): string {
	return (
		el.shadowRoot
			?.querySelector('wa-callout[variant="danger"]')
			?.textContent?.trim() ?? ""
	);
}

beforeEach(() => {
	findUserByEmailMock.mockReset();
	findProfilesMock.mockReset().mockResolvedValue(new Map());
	inviteToEventMock.mockReset().mockResolvedValue(undefined);
	offerInviteByEmailMock.mockReset().mockResolvedValue(undefined);
	revokeInviteMock.mockReset();
	changeInviteRoleMock.mockReset();
	updateEventMembershipMock.mockReset();
	listPendingInvitesMock.mockReset().mockResolvedValue([]);
});

test("an email with an account: writes eventInvites exactly as before, and shows a success message", async () => {
	findUserByEmailMock.mockResolvedValue({
		uid: "guest-uid",
		displayName: "Bea",
		photoURL: "",
	});

	const el = await mount(anEvent());
	await invite(el, "bea@example.com");

	expect(inviteToEventMock).toHaveBeenCalledWith({
		eventId: "event-1",
		eventTitle: "Concert",
		inviteeUid: "guest-uid",
		inviteeEmail: "bea@example.com",
		invitedBy: OWNER.uid,
		invitedByName: "Ana",
		role: "viewer",
	});
	expect(offerInviteByEmailMock).not.toHaveBeenCalled();
	expect(notice(el)).toContain("Invitation sent");
	expect(error(el)).toBe("");

	el.remove();
});

test("an email with no account: offers a pending invite by email instead of failing, with the exact same success message", async () => {
	findUserByEmailMock.mockResolvedValue(null);

	const el = await mount(anEvent());
	await invite(el, "newcomer@example.com");

	expect(offerInviteByEmailMock).toHaveBeenCalledWith({
		eventId: "event-1",
		eventTitle: "Concert",
		inviteeEmail: "newcomer@example.com",
		invitedBy: OWNER.uid,
		invitedByName: "Ana",
		role: "viewer",
	});
	expect(inviteToEventMock).not.toHaveBeenCalled();
	// The whole point of T64: this must read identically to the branch
	// above, not "nobody with that email has an account yet".
	expect(notice(el)).toContain("Invitation sent");
	expect(error(el)).toBe("");

	el.remove();
});

test("both branches end in the exact same success message", async () => {
	findUserByEmailMock.mockResolvedValueOnce({
		uid: "guest-uid",
		displayName: "Bea",
		photoURL: "",
	});
	const withAccount = await mount(anEvent());
	await invite(withAccount, "bea@example.com");
	const withAccountNotice = notice(withAccount);
	withAccount.remove();

	findUserByEmailMock.mockResolvedValueOnce(null);
	const withoutAccount = await mount(anEvent());
	await invite(withoutAccount, "newcomer@example.com");
	const withoutAccountNotice = notice(withoutAccount);
	withoutAccount.remove();

	expect(withAccountNotice).not.toBe("");
	expect(withAccountNotice).toBe(withoutAccountNotice);
});

test("a real failure looking up the email — permission-denied, offline — shows the generic error, not the no-account offer", async () => {
	// This must not be reachable through the normal flow (whoever invites
	// is already verified), but the two are still meant to behave
	// differently if it ever happens: see `findUserByEmail`'s own doc
	// comment and `#onInvite`'s.
	findUserByEmailMock.mockRejectedValue(new Error("permission-denied"));

	const el = await mount(anEvent());
	await invite(el, "someone@example.com");

	expect(inviteToEventMock).not.toHaveBeenCalled();
	expect(offerInviteByEmailMock).not.toHaveBeenCalled();
	expect(error(el)).toContain("could not be saved");
	expect(notice(el)).toBe("");

	el.remove();
});

test("inviting the owner's own address is still refused, whether or not an account is found first", async () => {
	findUserByEmailMock.mockResolvedValue({
		uid: OWNER.uid,
		displayName: "Ana",
		photoURL: "",
	});

	const el = await mount(anEvent());
	await invite(el, OWNER.email as string);

	expect(inviteToEventMock).not.toHaveBeenCalled();
	expect(offerInviteByEmailMock).not.toHaveBeenCalled();
	expect(error(el)).toContain("You already own this event");

	el.remove();
});

test("an already-invited member is still refused, unaffected by the no-account path", async () => {
	findUserByEmailMock.mockResolvedValue({
		uid: "guest-uid",
		displayName: "Bea",
		photoURL: "",
	});

	const el = await mount(anEvent({ memberIds: [OWNER.uid, "guest-uid"] }));
	await invite(el, "bea@example.com");

	expect(inviteToEventMock).not.toHaveBeenCalled();
	expect(offerInviteByEmailMock).not.toHaveBeenCalled();
	expect(error(el)).toContain("already in this event");

	el.remove();
});
