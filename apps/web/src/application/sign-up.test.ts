import { expect, test, vi } from "vitest";
import { ZodError } from "zod";
import type { SessionPort } from "./ports/session.js";
import { signUp } from "./sign-up.js";

function fakePort(): SessionPort {
	return {
		signIn: vi.fn().mockResolvedValue(undefined),
		signUp: vi.fn().mockResolvedValue(undefined),
		signInWithGoogle: vi.fn().mockResolvedValue(undefined),
		signOut: vi.fn().mockResolvedValue(undefined),
		sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
		refreshEmailVerification: vi.fn().mockResolvedValue(null),
	};
}

test("con contraseñas que coinciden, crea la cuenta por el puerto", async () => {
	const session = fakePort();

	await signUp(session, {
		email: "ana@example.com",
		password: "secret1",
		confirmPassword: "secret1",
	});

	expect(session.signUp).toHaveBeenCalledWith("ana@example.com", "secret1");
});

test("si las contraseñas no coinciden, rechaza sin tocar el puerto", async () => {
	const session = fakePort();

	await expect(
		signUp(session, {
			email: "ana@example.com",
			password: "secret1",
			confirmPassword: "secret2",
		}),
	).rejects.toBeInstanceOf(ZodError);

	expect(session.signUp).not.toHaveBeenCalled();
});
