import type { User } from "firebase/auth";

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";

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
