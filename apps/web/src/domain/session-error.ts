/**
 * A session failure, already translated from the provider.
 *
 * `application/ports/session.ts` documents that its methods reject with
 * this, never with the SDK's raw error. The `infrastructure/` adapter is
 * the one that does the translation — it knows which Firebase code
 * corresponds to each of these; `domain/auth-errors.ts` only knows these
 * codes and never `FirebaseError`.
 */
export type SessionErrorCode =
	| "invalid-credential"
	| "invalid-email"
	| "user-disabled"
	| "email-already-in-use"
	| "weak-password"
	| "popup-closed"
	| "popup-blocked"
	| "network-error"
	| "too-many-requests"
	/**
	 * The provider requires a session younger than it is. T32's account
	 * deletion is the one place this surfaces: `deleteUser()` demands a
	 * recent sign-in, and a session opened hours ago routinely isn't one.
	 * The caller reauthenticates and retries — see `deleteAccount()`.
	 */
	| "requires-recent-login"
	| "unknown";

/**
 * Doesn't carry the provider's raw message: it's built only from the code,
 * so there's no way for a sensitive SDK text to travel inside this
 * exception all the way to the UI.
 */
export class SessionError extends Error {
	constructor(readonly code: SessionErrorCode) {
		super(`session error: ${code}`);
		this.name = "SessionError";
	}
}
