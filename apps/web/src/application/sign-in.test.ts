import { expect, test, vi } from "vitest";
import { ZodError } from "zod";
import type { SessionPort } from "./ports/session.js";
import { signIn } from "./sign-in.js";

/**
 * In-memory port, no Firebase or emulators: that's the measure of success
 * for `docs/spec-arquitectura-hexagonal.md` — if this needed an emulator,
 * the port would be badly designed.
 */
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
	};
}

test("con credenciales válidas, entra por el puerto", async () => {
	const session = fakePort();

	await signIn(session, { email: "ana@example.com", password: "secret1" });

	expect(session.signIn).toHaveBeenCalledWith("ana@example.com", "secret1");
});

test("con un email inválido, rechaza sin tocar el puerto", async () => {
	const session = fakePort();

	await expect(
		signIn(session, { email: "no-es-un-email", password: "secret1" }),
	).rejects.toBeInstanceOf(ZodError);

	expect(session.signIn).not.toHaveBeenCalled();
});
