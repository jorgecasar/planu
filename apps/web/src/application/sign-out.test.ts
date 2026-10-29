import { expect, test, vi } from "vitest";
import type { SessionPort } from "./ports/session.js";
import { signOut } from "./sign-out.js";

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

test("delega en el puerto", async () => {
	const session = fakePort();

	await signOut(session);

	expect(session.signOut).toHaveBeenCalledOnce();
});
