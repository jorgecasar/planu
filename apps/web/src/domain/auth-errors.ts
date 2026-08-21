import { msg } from "@lit/localize";
import { ZodError } from "zod";
import { SessionError } from "./session-error.js";

/**
 * Translates any validation or session failure into text for the user.
 *
 * The messages are resolved inside the function and not in a module-level
 * map: `msg()` is evaluated when called, and a map created at import time
 * would freeze the language in effect at that instant.
 *
 * It no longer knows about `FirebaseError`: the one that translates the
 * provider's real code is `infrastructure/firebase/session-adapter.ts`,
 * before the failure reaches here. This only knows about `SessionError`,
 * which is the domain's own vocabulary.
 *
 * Wrong credentials, nonexistent user and wrong password share a message on
 * purpose: distinguishing them would let someone find out which emails are
 * registered. The collapse into a single code — `invalid-credential` — has
 * already happened by the time this code runs; see
 * `infrastructure/firebase/session-adapter.test.ts`.
 */
export function authErrorMessage(cause: unknown): string {
	const fallback = msg("Something went wrong. Please try again.");

	if (cause instanceof ZodError) {
		return cause.issues[0]?.message ?? fallback;
	}

	if (!(cause instanceof SessionError)) return fallback;

	switch (cause.code) {
		case "invalid-credential":
			return msg("Wrong email or password.");
		case "invalid-email":
			return msg("Enter a valid email address.");
		case "user-disabled":
			return msg("This account has been disabled.");
		case "email-already-in-use":
			return msg("That email is already registered.");
		case "weak-password":
			return msg("Password must be at least 6 characters.");
		case "popup-closed":
			return msg("The Google sign-in window was closed.");
		case "popup-blocked":
			return msg("Your browser blocked the sign-in window.");
		case "network-error":
			return msg("Network error. Check your connection.");
		case "too-many-requests":
			return msg("Too many attempts. Try again in a few minutes.");
		default:
			return fallback;
	}
}
