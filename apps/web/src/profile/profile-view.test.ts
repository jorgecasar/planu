import { expect, test, vi } from "vitest";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import type { SharingPort } from "../application/ports/sharing.js";
import "./profile-view.js";
import type { PlanuProfileView } from "./profile-view.js";

/**
 * `#onCheck` reaches `publishDirectoryEntry` through the `SharingPort` it
 * `@consume`s — see that port's own comment for why (it's the same port
 * `firebase-provider.ts` builds and calls from too, and the fix this file
 * exists for, T58, is precisely about not trusting its outcome blindly).
 * A plain object satisfying the interface, set directly on the element same
 * as `session` below, rather than mocking a module.
 */
const publishDirectoryEntryMock = vi.fn();
// T62's `claimPendingInvitesByEmail`, called right after `publishDirectoryEntry`
// with its own silent `.catch(() => {})` — resolved by default so it never
// interferes with what these tests are actually about.
const claimPendingInvitesByEmailMock = vi.fn().mockResolvedValue(undefined);

function fakeSharing(): SharingPort {
	return {
		findUserByEmail: vi.fn(),
		findProfiles: vi.fn(),
		listPendingInvites: vi.fn(),
		inviteToEvent: vi.fn(),
		offerInviteByEmail: vi.fn(),
		changeInviteRole: vi.fn(),
		revokeInvite: vi.fn(),
		updateEventMembership: vi.fn(),
		publishDirectoryEntry: publishDirectoryEntryMock,
		claimPendingInvitesByEmail: claimPendingInvitesByEmailMock,
	};
}

const UNVERIFIED_USER: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: false,
	provider: "password",
};

const VERIFIED_USER: SessionUser = { ...UNVERIFIED_USER, emailVerified: true };

/**
 * A `SessionPort` whose `refreshEmailVerification()` always resolves to
 * `refreshed` — `null` and "no longer verified" aren't exercised here, T58
 * is only about what happens to the notice once verification is confirmed.
 */
function fakeSession(refreshed: SessionUser | null): SessionPort {
	return {
		signIn: vi.fn(),
		signUp: vi.fn(),
		signInWithGoogle: vi.fn(),
		signOut: vi.fn(),
		sendVerificationEmail: vi.fn(),
		reauthenticate: vi.fn(),
		deleteAccount: vi.fn(),
		refreshEmailVerification: vi.fn().mockResolvedValue(refreshed),
	};
}

/**
 * Mounted with no `<planu-firebase-provider>` ancestor, same pattern as
 * `app-shell.test.ts`: `@consume` never resolves on its own here, so `user`,
 * `session` and `sharing` are set directly, bypassing the context.
 */
async function mount(
	user: SessionUser,
	session: SessionPort,
): Promise<PlanuProfileView> {
	const el = document.createElement("planu-profile-view") as PlanuProfileView;
	document.body.append(el);
	(el as unknown as { user: SessionUser }).user = user;
	(el as unknown as { session: SessionPort }).session = session;
	(el as unknown as { sharing: SharingPort }).sharing = fakeSharing();
	el.requestUpdate();
	await el.updateComplete;
	return el;
}

function notice(el: PlanuProfileView): Element | null | undefined {
	return el.shadowRoot?.querySelector("wa-callout");
}

function checkButton(el: PlanuProfileView): HTMLElement {
	const buttons = [
		...(el.shadowRoot?.querySelectorAll("wa-callout wa-button") ?? []),
	];
	const button = buttons.find((candidate) =>
		candidate.textContent?.trim().includes("verified"),
	);
	if (!button) throw new Error("Retry button not found in the notice");
	return button as HTMLElement;
}

/**
 * Waits out `#onCheck`'s async chain by polling the component's own
 * `checking` flag (its `finally` block, not a guess about timing) rather
 * than sleeping a fixed amount.
 */
async function settle(el: PlanuProfileView): Promise<void> {
	await vi.waitFor(
		() => {
			if ((el as unknown as { checking: boolean }).checking) {
				throw new Error("still checking");
			}
		},
		{ timeout: 2000, interval: 10 },
	);
	await el.updateComplete;
}

test("cuenta sin verificar: se ve el aviso con el botón de comprobar", async () => {
	const el = await mount(UNVERIFIED_USER, fakeSession(null));

	expect(notice(el)).not.toBeNull();

	el.remove();
});

test("publicación con éxito: el aviso desaparece", async () => {
	publishDirectoryEntryMock.mockReset().mockResolvedValue(undefined);
	claimPendingInvitesByEmailMock.mockClear();
	const el = await mount(UNVERIFIED_USER, fakeSession(VERIFIED_USER));

	checkButton(el).click();
	await settle(el);

	expect(publishDirectoryEntryMock).toHaveBeenCalledWith(VERIFIED_USER);
	// Same trigger claims pending-by-email offers too, immediately after —
	// see the call site's own comment in `#onCheck`.
	expect(claimPendingInvitesByEmailMock).toHaveBeenCalledWith(VERIFIED_USER);
	expect(notice(el)).toBeNull();

	el.remove();
});

test("publicación que falla: el aviso sigue visible con el botón de reintento disponible", async () => {
	publishDirectoryEntryMock
		.mockReset()
		.mockRejectedValue(new Error("permission-denied"));
	const el = await mount(UNVERIFIED_USER, fakeSession(VERIFIED_USER));

	checkButton(el).click();
	await settle(el);

	// Regression coverage for T58: assigning `this.user = refreshed` before
	// the publish resolved used to hide the notice here too, even though
	// `publishDirectoryEntry` above never actually succeeded.
	expect(notice(el)).not.toBeNull();
	const button = checkButton(el);
	expect(button.hasAttribute("disabled")).toBe(false);

	el.remove();
});

test("reintento tras fallo: pulsar otra vez puede volver a intentarlo", async () => {
	publishDirectoryEntryMock
		.mockReset()
		.mockRejectedValueOnce(new Error("permission-denied"))
		.mockResolvedValueOnce(undefined);
	const el = await mount(UNVERIFIED_USER, fakeSession(VERIFIED_USER));

	checkButton(el).click();
	await settle(el);
	expect(notice(el)).not.toBeNull();

	checkButton(el).click();
	await settle(el);

	expect(publishDirectoryEntryMock).toHaveBeenCalledTimes(2);
	expect(notice(el)).toBeNull();

	el.remove();
});
