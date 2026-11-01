import { expect, test, vi } from "vitest";
import { ZodError } from "zod";
import { SessionError } from "../domain/session-error.js";
import { changeEmail } from "./change-email.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

function fakePort(): SessionPort {
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

const USER: SessionUser = {
	uid: "u1",
	email: "ana@exmaple.com",
	displayName: null,
	photoURL: null,
	emailVerified: false,
	provider: "password",
};

test("con una dirección válida y distinta, pide el cambio por el puerto", async () => {
	const session = fakePort();

	const sentTo = await changeEmail(session, USER, "  ana@example.com ");

	// Trimmed before it reaches the provider: a stray space pasted along
	// with the address would otherwise be refused as invalid.
	expect(session.changeEmail).toHaveBeenCalledWith("ana@example.com");
	expect(sentTo).toBe("ana@example.com");
});

test("una dirección mal formada se rechaza sin tocar el puerto", async () => {
	const session = fakePort();

	await expect(changeEmail(session, USER, "not-an-email")).rejects.toThrow(
		ZodError,
	);
	expect(session.changeEmail).not.toHaveBeenCalled();
});

test("la misma dirección que ya tiene —sin importar mayúsculas— se rechaza sin tocar el puerto", async () => {
	const session = fakePort();

	await expect(changeEmail(session, USER, "ANA@exmaple.com")).rejects.toThrow(
		ZodError,
	);
	expect(session.changeEmail).not.toHaveBeenCalled();
});

test("el SessionError del puerto se propaga tal cual", async () => {
	const session = fakePort();
	vi.mocked(session.changeEmail).mockRejectedValue(
		new SessionError("requires-recent-login"),
	);

	await expect(
		changeEmail(session, USER, "ana@example.com"),
	).rejects.toMatchObject({ code: "requires-recent-login" });
});

test("si la cuenta ya está verificada —en otro dispositivo—, rechaza sin cambiar nada", async () => {
	// A verified account has a directory entry under its current address
	// that only a token carrying that address can delete: switching would
	// orphan it for good.
	const session = fakePort();
	vi.mocked(session.refreshEmailVerification).mockResolvedValue({
		...USER,
		emailVerified: true,
	});

	await expect(
		changeEmail(session, USER, "ana@example.com"),
	).rejects.toMatchObject({ code: "already-verified" });
	expect(session.changeEmail).not.toHaveBeenCalled();
});

test("comprueba la verificación antes de pedir el cambio", async () => {
	const session = fakePort();

	await changeEmail(session, USER, "ana@example.com");

	expect(session.refreshEmailVerification).toHaveBeenCalledOnce();
	expect(
		vi.mocked(session.refreshEmailVerification).mock.invocationCallOrder[0],
	).toBeLessThan(
		vi.mocked(session.changeEmail).mock.invocationCallOrder[0] ?? 0,
	);
});
