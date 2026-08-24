import type { SessionUser } from "../application/ports/session.js";

/**
 * The application lives under /app, leaving the root for the public landing.
 *
 * The landing is static HTML with no JavaScript of its own, so it cannot share
 * an entry point with the application: anyone who has not signed up would
 * otherwise download Lit, the router and the Firebase SDK to read a page that
 * needs none of them.
 */
export const APP_BASE = "/app";
export const LOGIN_PATH = `${APP_BASE}/login`;
export const HOME_PATH = APP_BASE;
export const PROFILE_PATH = `${APP_BASE}/profile`;

/**
 * Decides where to redirect to based on the session and the current route.
 * Returns `null` when there is nothing to move.
 *
 * The `undefined` state —still checking— is the one that matters: treating it
 * as "no session" would send an already-authenticated user to the login
 * during the instant it takes Firebase to restore the session.
 *
 * This is a UX layer only, not the enforcement boundary: an unverified email
 * can still read and write its own events through Firestore directly, since
 * this guard runs entirely on the client. The rule that will actually enforce
 * it lives in `firestore.rules` (see T59 in `tasks/todo.md`).
 */
export function guardRedirect(
	user: SessionUser | null | undefined,
	pathname: string,
): string | null {
	if (user === undefined) return null;

	if (user === null) {
		return pathname === LOGIN_PATH ? null : LOGIN_PATH;
	}

	if (pathname === LOGIN_PATH) return HOME_PATH;

	// Accounts without an email (none exist today; every adapter requires
	// one) have nothing to verify, so they're left alone rather than sent
	// into a redirect loop against a notice that would never resolve.
	const unverified = user.email !== null && !user.emailVerified;
	if (unverified && pathname !== PROFILE_PATH) return PROFILE_PATH;

	return null;
}
