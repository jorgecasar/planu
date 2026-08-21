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
