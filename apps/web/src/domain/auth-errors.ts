import { msg } from "@lit/localize";
import { ZodError } from "zod";
import { SessionError } from "./session-error.js";

/** A form field an error can be shown next to. */
export type AuthField = "email" | "password" | "confirmPassword";

const FIELDS: readonly string[] = ["email", "password", "confirmPassword"];

/**
 * Which field caused the failure, so the message sits next to it instead of
 * above the whole form. `null` when no field is to blame —a closed popup, a
 * network error—, and then it stays a general notice.
 *
 * Wrong credentials point at the password: the message names both fields on
 * purpose (see `authErrorMessage`), and the password is the one to retype.
 */
export function authErrorField(cause: unknown): AuthField | null {
	if (cause instanceof ZodError) {
		const field = String(cause.issues[0]?.path[0] ?? "");
		return FIELDS.includes(field) ? (field as AuthField) : null;
	}
	if (!(cause instanceof SessionError)) return null;
	switch (cause.code) {
		case "invalid-email":
		case "user-disabled":
		case "email-already-in-use":
			return "email";
		case "invalid-credential":
		case "weak-password":
			return "password";
		default:
			return null;
	}
}

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
		case "already-verified":
			return msg(
				"Your email is already verified. Reload the page to continue.",
			);
		case "requires-recent-login":
			return msg("For your security, sign out, sign in again and retry.");
		default:
			return fallback;
	}
}
