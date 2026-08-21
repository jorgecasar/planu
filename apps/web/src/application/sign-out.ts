import type { SessionPort } from "./ports/session.js";

/**
 * Cierra la sesión. Tan fino que es casi el puerto desnudo, y aun así es lo
 * que evita que `app-shell.ts` y `profile-view.ts` importen `signOut` de
 * `firebase/auth` cada uno por su lado.
 */
export function signOut(session: SessionPort): Promise<void> {
	return session.signOut();
}
