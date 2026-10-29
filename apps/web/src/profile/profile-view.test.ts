import { afterEach, expect, test, vi } from "vitest";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
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
	// The form that had focus is gone: focus moves to the confirmation.
	expect(el.shadowRoot?.activeElement).toBe(status);
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
