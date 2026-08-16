import type { User } from "firebase/auth";

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
 * Decide a dónde reencaminar según la sesión y la ruta actual.
 * Devuelve `null` cuando no hay que moverse.
 *
 * El estado `undefined` —todavía comprobando— es el que importa: tratarlo como
 * "sin sesión" mandaría al login a un usuario ya autenticado durante el instante
 * que tarda Firebase en restaurar la sesión.
 */
export function guardRedirect(
	user: User | null | undefined,
	pathname: string,
): string | null {
	if (user === undefined) return null;

	if (user === null) {
		return pathname === LOGIN_PATH ? null : LOGIN_PATH;
	}

	return pathname === LOGIN_PATH ? HOME_PATH : null;
}
