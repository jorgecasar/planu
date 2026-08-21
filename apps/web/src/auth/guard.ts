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

/**
 * Decides where to redirect to based on the session and the current route.
 * Returns `null` when there is nothing to move.
 *
 * The `undefined` state —still checking— is the one that matters: treating it
 * as "no session" would send an already-authenticated user to the login
 * during the instant it takes Firebase to restore the session.
 */
export function guardRedirect(
	user: SessionUser | null | undefined,
	pathname: string,
): string | null {
	if (user === undefined) return null;

	if (user === null) {
		return pathname === LOGIN_PATH ? null : LOGIN_PATH;
	}

	return pathname === LOGIN_PATH ? HOME_PATH : null;
}
