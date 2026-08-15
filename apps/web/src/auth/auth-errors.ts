import { FirebaseError } from "firebase/app";
import { ZodError } from "zod";

/**
 * Credenciales incorrectas, usuario inexistente y contraseña errónea comparten
 * mensaje a propósito: distinguirlos permitiría averiguar qué correos están
 * registrados.
 */
const MESSAGES: Record<string, string> = {
	"auth/invalid-credential": "Wrong email or password.",
	"auth/user-not-found": "Wrong email or password.",
	"auth/wrong-password": "Wrong email or password.",
	"auth/invalid-email": "Enter a valid email address.",
	"auth/user-disabled": "This account has been disabled.",
	"auth/email-already-in-use": "That email is already registered.",
	"auth/weak-password": "Password must be at least 6 characters.",
	"auth/popup-closed-by-user": "The Google sign-in window was closed.",
	"auth/popup-blocked": "Your browser blocked the sign-in window.",
	"auth/network-request-failed": "Network error. Check your connection.",
	"auth/too-many-requests": "Too many attempts. Try again in a few minutes.",
};

const FALLBACK = "Something went wrong. Please try again.";

/** Traduce a texto para el usuario cualquier fallo de validación o de Firebase. */
export function authErrorMessage(cause: unknown): string {
	if (cause instanceof ZodError) {
		return cause.issues[0]?.message ?? FALLBACK;
	}
	if (cause instanceof FirebaseError) {
		return MESSAGES[cause.code] ?? FALLBACK;
	}
	return FALLBACK;
}
