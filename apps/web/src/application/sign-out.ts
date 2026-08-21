import type { SessionPort } from "./ports/session.js";

/**
 * Signs the session out. So thin it's almost the bare port, and it still
 * keeps `app-shell.ts` and `profile-view.ts` from each importing `signOut`
 * from `firebase/auth` on their own.
 */
export function signOut(session: SessionPort): Promise<void> {
	return session.signOut();
}
