import { msg } from "@lit/localize";
import { FirebaseError } from "firebase/app";
import { ZodError } from "zod";

/**
 * Traduce a texto para el usuario cualquier fallo de validación o de Firebase.
 *
 * Los mensajes se resuelven dentro de la función y no en un mapa a nivel de
 * módulo: `msg()` se evalúa al llamarlo, y un mapa creado al importar
 * congelaría el idioma que hubiera en ese instante.
 *
 * Credenciales incorrectas, usuario inexistente y contraseña errónea comparten
 * mensaje a propósito: distinguirlos permitiría averiguar qué correos están
 * registrados.
 */
export function authErrorMessage(cause: unknown): string {
	const fallback = msg("Something went wrong. Please try again.");

	if (cause instanceof ZodError) {
		return cause.issues[0]?.message ?? fallback;
	}

	if (!(cause instanceof FirebaseError)) return fallback;

	switch (cause.code) {
		case "auth/invalid-credential":
		case "auth/user-not-found":
		case "auth/wrong-password":
			return msg("Wrong email or password.");
		case "auth/invalid-email":
			return msg("Enter a valid email address.");
		case "auth/user-disabled":
			return msg("This account has been disabled.");
		case "auth/email-already-in-use":
			return msg("That email is already registered.");
		case "auth/weak-password":
			return msg("Password must be at least 6 characters.");
		case "auth/popup-closed-by-user":
			return msg("The Google sign-in window was closed.");
		case "auth/popup-blocked":
			return msg("Your browser blocked the sign-in window.");
		case "auth/network-request-failed":
			return msg("Network error. Check your connection.");
		case "auth/too-many-requests":
			return msg("Too many attempts. Try again in a few minutes.");
		default:
			return fallback;
	}
}
