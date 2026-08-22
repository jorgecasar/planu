import { expect, test, vi } from "vitest";
import { ZodError } from "zod";
import type { AnalyticsPort } from "./ports/analytics.js";
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

function fakeAnalytics(): AnalyticsPort {
	return {
		trackSignUp: vi.fn(),
		trackFirstEventCreated: vi.fn(),
		trackShare: vi.fn(),
		trackAiUsed: vi.fn(),
	};
}

test("con contraseñas que coinciden, crea la cuenta por el puerto y registra el alta", async () => {
	const session = fakePort();
	const analytics = fakeAnalytics();

	await signUp(session, analytics, {
		email: "ana@example.com",
		password: "secret1",
		confirmPassword: "secret1",
	});

	expect(session.signUp).toHaveBeenCalledWith("ana@example.com", "secret1");
	expect(analytics.trackSignUp).toHaveBeenCalledOnce();
});

test("si las contraseñas no coinciden, rechaza sin tocar ningún puerto", async () => {
	const session = fakePort();
	const analytics = fakeAnalytics();

	await expect(
		signUp(session, analytics, {
			email: "ana@example.com",
			password: "secret1",
			confirmPassword: "secret2",
		}),
	).rejects.toBeInstanceOf(ZodError);

	expect(session.signUp).not.toHaveBeenCalled();
	expect(analytics.trackSignUp).not.toHaveBeenCalled();
});

test("si el puerto de sesión lanza, no registra el alta", async () => {
	const session = fakePort();
	vi.mocked(session.signUp).mockRejectedValue(new Error("email in use"));
	const analytics = fakeAnalytics();

	await expect(
		signUp(session, analytics, {
			email: "ana@example.com",
			password: "secret1",
			confirmPassword: "secret1",
		}),
	).rejects.toThrow("email in use");

	expect(analytics.trackSignUp).not.toHaveBeenCalled();
});
