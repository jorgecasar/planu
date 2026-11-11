import { afterEach, expect, test, vi } from "vitest";
import type { AccountDataPort } from "../application/ports/account-data.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import type { SharingPort } from "../application/ports/sharing.js";
import { SessionError } from "../domain/session-error.js";
import "./profile-view.js";
import type { PlanuProfileView } from "./profile-view.js";

function fakeSession(): SessionPort {
	return {
		signIn: vi.fn().mockResolvedValue(undefined),
		signUp: vi.fn().mockResolvedValue(undefined),
		signInWithGoogle: vi.fn().mockResolvedValue(undefined),
		signOut: vi.fn().mockResolvedValue(undefined),
		sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
		refreshEmailVerification: vi.fn().mockResolvedValue(null),
		reauthenticate: vi.fn().mockResolvedValue(undefined),
		deleteAccount: vi.fn().mockResolvedValue(undefined),
		changeEmail: vi.fn().mockResolvedValue(undefined),
	};
}

const UNVERIFIED: SessionUser = {
	uid: "u1",
	email: "ana@exmaple.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: false,
	provider: "password",
};

/**
 * The contexts are never provided here, so `@consume` leaves the fields
 * alone and the test can set them directly — the same values a provider
 * would hand down.
 */
async function mount(
	user: SessionUser,
	session: SessionPort = fakeSession(),
): Promise<PlanuProfileView> {
	const el = document.createElement("planu-profile-view");
	Object.assign(el, { user, session });
	document.body.append(el);
	await el.updateComplete;
	return el;
}

afterEach(() => {
	document.body.replaceChildren();
});

function buttons(el: PlanuProfileView): HTMLElement[] {
	return [...(el.shadowRoot?.querySelectorAll<HTMLElement>("wa-button") ?? [])];
}

function button(el: PlanuProfileView, label: string): HTMLElement | undefined {
	return buttons(el).find((b) => b.textContent?.trim() === label);
}

async function openAndFill(el: PlanuProfileView, value: string) {
	button(el, "Wrong email? Change it")?.click();
	await el.updateComplete;
	await fillNewEmail(el, value);
}

/** Fills the new-email field of a form that is already open. */
async function fillNewEmail(el: PlanuProfileView, value: string) {
	const input = el.shadowRoot?.querySelector<HTMLInputElement>(
		'wa-input[type="email"]',
	);
	if (!input) throw new Error("No new-email field");
	input.value = value;
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
}

function statusText(el: PlanuProfileView): string {
	return (
		el.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim() ?? ""
	);
}

async function submit(el: PlanuProfileView) {
	el.shadowRoot?.querySelector("form")?.requestSubmit();
	// Settled once there is an outcome on screen: the confirmation, or an
	// error. Waiting only for "Sending…" to vanish races the first render.
	await vi.waitFor(() => {
		if (!statusText(el) && !el.shadowRoot?.querySelector('[role="alert"]')) {
			throw new Error("no outcome yet");
		}
	});
	await el.updateComplete;
}

test("una cuenta sin verificar sigue teniendo 'Delete account' disponible (RGPD, art. 17)", async () => {
	const el = await mount(UNVERIFIED);

	const del = button(el, "Delete account");
	expect(del).toBeDefined();
	expect(del?.hasAttribute("disabled")).toBe(false);
});

test("una cuenta de contraseña sin verificar puede cambiar un email mal escrito", async () => {
	const el = await mount(UNVERIFIED);

	expect(button(el, "Wrong email? Change it")).toBeDefined();
});

test("una cuenta verificada no ve el aviso ni la opción de cambiar el email", async () => {
	const el = await mount({ ...UNVERIFIED, emailVerified: true });

	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();
	expect(button(el, "Wrong email? Change it")).toBeUndefined();
	expect(button(el, "Delete account")).toBeDefined();
});

test("una cuenta de Google no ofrece cambiar el email: su dirección es de Google", async () => {
	const el = await mount({ ...UNVERIFIED, provider: "google.com" });

	expect(button(el, "Wrong email? Change it")).toBeUndefined();
});

test("enviar el formulario pide el cambio por el puerto y confirma a qué dirección fue el enlace", async () => {
	const session = fakeSession();
	const el = await mount(UNVERIFIED, session);

	await openAndFill(el, "ana@example.com");
	await submit(el);

	expect(session.changeEmail).toHaveBeenCalledWith("ana@example.com");
	const status = el.shadowRoot?.querySelector('[role="status"]');
	expect(status?.textContent).toContain("ana@example.com");
	expect(el.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
});

test("tras enviar, el foco va al botón que sustituye al formulario, no a la región viva", async () => {
	// Focusing a live region makes screen readers read its text twice.
	const el = await mount(UNVERIFIED, fakeSession());

	await openAndFill(el, "ana@example.com");
	await submit(el);

	const status = el.shadowRoot?.querySelector('[role="status"]');
	expect(status?.textContent).toContain("ana@example.com");
	expect(status?.hasAttribute("tabindex")).toBe(false);
	expect(el.shadowRoot?.activeElement).not.toBe(status);
	expect(el.shadowRoot?.activeElement).toBe(
		button(el, "Use a different email"),
	);
});

test("si el proveedor exige un inicio de sesión reciente, lo dice en vez de dar el enlace por enviado", async () => {
	const session = fakeSession();
	vi.mocked(session.changeEmail).mockRejectedValue(
		new SessionError("requires-recent-login"),
	);
	const el = await mount(UNVERIFIED, session);

	await openAndFill(el, "ana@example.com");
	await submit(el);

	const alert = el.shadowRoot?.querySelector('[role="alert"]');
	expect(alert?.textContent).toContain("sign in again");
	expect(statusText(el)).toBe("");
});

test("volver a escribir la misma dirección se rechaza sin llegar al puerto", async () => {
	// A malformed address never gets this far — `type="email"` plus
	// `required` stop the submit natively. Re-entering the current one is
	// what does get past the browser, and would only resend the same
	// unclickable link.
	const session = fakeSession();
	const el = await mount(UNVERIFIED, session);

	await openAndFill(el, "ANA@exmaple.com");
	await submit(el);

	expect(session.changeEmail).not.toHaveBeenCalled();
	const alert = el.shadowRoot?.querySelector('[role="alert"]');
	expect(alert?.textContent).toContain("That is already your email.");
});

test("el aviso tiene su región de estado desde el principio, vacía, para que el éxito se anuncie", async () => {
	// A live region inserted together with its text often isn't announced.
	const el = await mount(UNVERIFIED);

	expect(el.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
	expect(statusText(el)).toBe("");
});

test("abrir el formulario lleva el foco al campo del email nuevo", async () => {
	const el = await mount(UNVERIFIED);

	button(el, "Wrong email? Change it")?.click();
	await vi.waitFor(() => {
		if (!el.shadowRoot?.activeElement) throw new Error("nothing focused");
	});

	expect(el.shadowRoot?.activeElement?.matches('wa-input[type="email"]')).toBe(
		true,
	);
});

test("tras enviar, 'Use a different email' permite corregir otra errata", async () => {
	const session = fakeSession();
	const el = await mount(UNVERIFIED, session);
	await openAndFill(el, "ana@example.com");
	await submit(el);

	button(el, "Use a different email")?.click();
	await vi.waitFor(() => {
		if (!el.shadowRoot?.querySelector('wa-input[type="email"]')) {
			throw new Error("form not back");
		}
	});
	await el.updateComplete;

	expect(statusText(el)).toBe("");
	expect(el.shadowRoot?.activeElement?.matches('wa-input[type="email"]')).toBe(
		true,
	);

	await fillNewEmail(el, "ana@example.org");
	await submit(el);
	expect(session.changeEmail).toHaveBeenLastCalledWith("ana@example.org");
	expect(statusText(el)).toContain("ana@example.org");
});

test("si la cuenta resulta estar ya verificada, lo dice y no pide el cambio", async () => {
	const session = fakeSession();
	vi.mocked(session.refreshEmailVerification).mockResolvedValue({
		...UNVERIFIED,
		emailVerified: true,
	});
	const el = await mount(UNVERIFIED, session);

	await openAndFill(el, "ana@example.com");
	await submit(el);

	expect(session.changeEmail).not.toHaveBeenCalled();
	const alert = el.shadowRoot?.querySelector('[role="alert"]');
	expect(alert?.textContent).toContain("already verified");
});

test("cancelar devuelve el foco al botón que abrió el formulario", async () => {
	const el = await mount(UNVERIFIED);
	button(el, "Wrong email? Change it")?.click();
	await vi.waitFor(() => {
		if (!el.shadowRoot?.activeElement) throw new Error("nothing focused");
	});

	button(el, "Cancel")?.click();
	await vi.waitFor(() => {
		if (el.shadowRoot?.querySelector('wa-input[type="email"]')) {
			throw new Error("form still open");
		}
	});
	await el.updateComplete;

	expect(el.shadowRoot?.activeElement).toBe(
		button(el, "Wrong email? Change it"),
	);
});

/** Only what `#onCheck` calls; the rest of the port is never reached. */
function fakeSharing(
	publish: SharingPort["publishDirectoryEntry"],
): SharingPort {
	return {
		publishDirectoryEntry: publish,
	} as Partial<SharingPort> as SharingPort;
}

/** Presses "I have verified it" and waits for the `calls`-th publish to settle. */
async function check(el: PlanuProfileView, publish: unknown, calls: number) {
	button(el, "I have verified it")?.click();
	await vi.waitFor(() => {
		expect(publish).toHaveBeenCalledTimes(calls);
		if (button(el, "Checking…")) throw new Error("still checking");
	});
	await el.updateComplete;
}

async function mountVerifying(publish: SharingPort["publishDirectoryEntry"]) {
	const session = fakeSession();
	vi.mocked(session.refreshEmailVerification).mockResolvedValue({
		...UNVERIFIED,
		emailVerified: true,
	});
	const el = await mount(UNVERIFIED, session);
	Object.assign(el, { sharing: fakeSharing(publish) });
	await el.updateComplete;
	return el;
}

test("al comprobar la verificación, el aviso se va cuando el directorio se publica", async () => {
	const publish = vi.fn().mockResolvedValue(undefined);
	const el = await mountVerifying(publish);

	await check(el, publish, 1);

	expect(publish).toHaveBeenCalledWith({ ...UNVERIFIED, emailVerified: true });
	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();
});

test("si publicar en el directorio falla, el aviso se queda para reintentar", async () => {
	const publish = vi
		.fn()
		.mockRejectedValueOnce(new Error("permission-denied"))
		.mockResolvedValueOnce(undefined);
	const el = await mountVerifying(publish);

	await check(el, publish, 1);
	expect(el.shadowRoot?.querySelector("wa-callout")).not.toBeNull();
	expect(button(el, "I have verified it")?.hasAttribute("disabled")).toBe(
		false,
	);

	await check(el, publish, 2);
	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();
});

function fakeAccount(): AccountDataPort {
	return {
		listMemberEvents: vi.fn().mockResolvedValue([]),
		deleteOwnEvent: vi.fn().mockResolvedValue(undefined),
		leaveEvent: vi.fn().mockResolvedValue(undefined),
		deleteEventImage: vi.fn().mockResolvedValue(undefined),
		deleteAllEventImages: vi.fn().mockResolvedValue(undefined),
		deleteDirectoryEntries: vi.fn().mockResolvedValue(undefined),
		deleteReceivedInvitations: vi.fn().mockResolvedValue(undefined),
		deleteSentInvitations: vi.fn().mockResolvedValue(undefined),
	};
}

/** Never settles: keeps a step in flight for as long as the test needs. */
const pending = () => new Promise<never>(() => {});

async function mountDeletable(session: SessionPort = fakeSession()) {
	const el = await mount(UNVERIFIED, session);
	Object.assign(el, { account: fakeAccount() });
	await el.updateComplete;
	return el;
}

function deleteDialog(el: PlanuProfileView): HTMLElement & { open: boolean } {
	const dialog = el.shadowRoot?.querySelector<HTMLElement & { open: boolean }>(
		"wa-dialog",
	);
	if (!dialog) throw new Error("No delete dialog");
	return dialog;
}

function dialogButton(el: PlanuProfileView, label: string) {
	return [...deleteDialog(el).querySelectorAll<HTMLElement>("wa-button")].find(
		(b) => b.textContent?.trim() === label,
	);
}

/** Opens the delete dialog, types the email and presses its "Delete account". */
async function startDelete(el: PlanuProfileView) {
	button(el, "Delete account")?.click();
	await el.updateComplete;
	const input = deleteDialog(el).querySelector<HTMLInputElement>("wa-input");
	if (!input) throw new Error("No confirmation field");
	input.value = UNVERIFIED.email ?? "";
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
	dialogButton(el, "Delete account")?.click();
	await el.updateComplete;
}

/** Runs the delete into the reauthentication step, with the password typed. */
async function reachReauth(session: SessionPort, el: PlanuProfileView) {
	vi.mocked(session.refreshEmailVerification).mockResolvedValue(UNVERIFIED);
	vi.mocked(session.deleteAccount).mockRejectedValue(
		new SessionError("requires-recent-login"),
	);
	await startDelete(el);
	const password = await vi.waitFor(() => {
		const field = deleteDialog(el).querySelector<HTMLInputElement>(
			'wa-input[type="password"]',
		);
		if (!field) throw new Error("no reauth step yet");
		return field;
	});
	password.value = "secret";
	password.dispatchEvent(new Event("input"));
	await el.updateComplete;
	return password;
}

/**
 * Presses Escape the way Web Awesome hears it — its document listener, which
 * calls `requestClose` — not a synthetic `wa-hide`, which skips the check
 * that matters. Waits for the hide or pulse animation that starts to end,
 * and returns whether the `wa-hide` was cancelled.
 */
async function pressEscape(el: PlanuProfileView): Promise<boolean> {
	const dialog = deleteDialog(el);
	await vi.waitFor(() => expect(dialog.open).toBe(true));
	let prevented: boolean | undefined;
	dialog.addEventListener(
		"wa-hide",
		(event) => {
			prevented = event.defaultPrevented;
		},
		{ once: true },
	);
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	const inner = dialog.shadowRoot?.querySelector("dialog");
	await vi.waitFor(() => {
		if (
			inner?.classList.contains("hide") ||
			inner?.classList.contains("pulse")
		) {
			throw new Error("still animating");
		}
	});
	await el.updateComplete;
	if (prevented === undefined) throw new Error("wa-hide never fired");
	return prevented;
}

test("Escape no cierra el diálogo con el borrado en curso", async () => {
	const session = fakeSession();
	vi.mocked(session.refreshEmailVerification).mockReturnValue(pending());
	const el = await mountDeletable(session);
	await startDelete(el);
	expect(dialogButton(el, "Deleting…")).toBeDefined();

	expect(await pressEscape(el)).toBe(true);

	expect(deleteDialog(el).open).toBe(true);
	expect(dialogButton(el, "Deleting…")).toBeDefined();
});

test("Escape no cierra el diálogo con la reautenticación en curso", async () => {
	const session = fakeSession();
	const el = await mountDeletable(session);
	await reachReauth(session, el);
	vi.mocked(session.reauthenticate).mockReturnValue(pending());
	dialogButton(el, "Confirm and delete")?.click();
	await el.updateComplete;
	expect(dialogButton(el, "Confirming…")).toBeDefined();

	expect(await pressEscape(el)).toBe(true);

	expect(deleteDialog(el).open).toBe(true);
	expect(dialogButton(el, "Confirming…")).toBeDefined();
});

test("sin nada en curso, Escape cierra el diálogo de borrar cuenta", async () => {
	const el = await mountDeletable();
	button(el, "Delete account")?.click();
	await el.updateComplete;

	expect(await pressEscape(el)).toBe(false);

	await vi.waitFor(() => expect(deleteDialog(el).open).toBe(false));
});

test("una reautenticación rechazada lo dice y deja reintentar o cancelar", async () => {
	const session = fakeSession();
	const el = await mountDeletable(session);
	const password = await reachReauth(session, el);
	vi.mocked(session.reauthenticate).mockRejectedValue(
		new SessionError("invalid-credential"),
	);

	dialogButton(el, "Confirm and delete")?.click();
	await vi.waitFor(() => {
		if (dialogButton(el, "Confirming…")) throw new Error("still confirming");
		expect(
			deleteDialog(el).querySelector('[role="alert"]')?.textContent?.trim(),
		).toBe("That did not work. Please try again.");
	});
	await el.updateComplete;

	expect(password.hasAttribute("disabled")).toBe(false);
	expect(dialogButton(el, "Cancel")?.hasAttribute("disabled")).toBe(false);
	expect(session.deleteAccount).toHaveBeenCalledTimes(1);
});
