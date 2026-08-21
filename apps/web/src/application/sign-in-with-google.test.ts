import { expect, test, vi } from "vitest";
import type { SessionPort } from "./ports/session.js";
import { signInWithGoogle } from "./sign-in-with-google.js";

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

test("delega en el puerto, sin nada que validar antes", async () => {
	const session = fakePort();

	await signInWithGoogle(session);

	expect(session.signInWithGoogle).toHaveBeenCalledOnce();
});
