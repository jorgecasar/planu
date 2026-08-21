import type { SessionPort } from "./ports/session.js";

/**
 * No validation of its own: Google doesn't ask for credentials to check
 * here. The seam still earns its keep because it's what lets the component
 * stop constructing a `GoogleAuthProvider`.
 */
export function signInWithGoogle(session: SessionPort): Promise<void> {
	return session.signInWithGoogle();
}
