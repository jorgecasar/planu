import { msg } from "@lit/localize";
import { ZodError } from "zod";
import { SessionError } from "./session-error.js";

/**
 * Traduce a texto para el usuario cualquier fallo de validación o de sesión.
 *
 * Los mensajes se resuelven dentro de la función y no en un mapa a nivel de
 * módulo: `msg()` se evalúa al llamarlo, y un mapa creado al importar
 * congelaría el idioma que hubiera en ese instante.
 *
 * Ya no conoce `FirebaseError`: quien traduce el código real del proveedor es
 * `infrastructure/firebase/session-adapter.ts`, antes de que el fallo llegue
 * aquí. Esto sólo sabe de `SessionError`, que es el vocabulario del dominio.
 *
 * Credenciales incorrectas, usuario inexistente y contraseña errónea
 * comparten mensaje a propósito: distinguirlos permitiría averiguar qué
 * correos están registrados. El colapso a un único código —
 * `invalid-credential`— ya ha ocurrido para cuando este código se ejecuta;
 * ver `infrastructure/firebase/session-adapter.test.ts`.
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
		default:
			return fallback;
	}
}
