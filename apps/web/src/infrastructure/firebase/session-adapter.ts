import { FirebaseError } from "firebase/app";
import {
	type Auth,
	createUserWithEmailAndPassword,
	signOut as firebaseSignOut,
	GoogleAuthProvider,
	reload,
	sendEmailVerification,
	signInWithEmailAndPassword,
	signInWithPopup,
	type User,
} from "firebase/auth";
import type {
	SessionPort,
	SessionUser,
} from "../../application/ports/session.js";
import {
	SessionError,
	type SessionErrorCode,
} from "../../domain/session-error.js";

/**
 * Lo que el dominio necesita del `User` de Firebase, y nada más.
 *
 * `getIdTokenResult` delega en el método real de `user`: es la única forma
 * en que `SessionUser` puede llevar el claim `premium` (T23) sin que su
 * firma conozca `firebase/auth`.
 */
export function toSessionUser(user: User): SessionUser {
	return {
		uid: user.uid,
		email: user.email,
		displayName: user.displayName,
		photoURL: user.photoURL,
		emailVerified: user.emailVerified,
		getIdTokenResult: () => user.getIdTokenResult(),
	};
}

/**
 * De código de Firebase a código de dominio. Tres códigos distintos colapsan
 * a `invalid-credential` a propósito: distinguirlos permitiría averiguar qué
 * correos están registrados. Ver `domain/auth-errors.test.ts`, que prueba el
 * mensaje, y el test de este fichero, que prueba el colapso.
 */
const CODIGOS: Record<string, SessionErrorCode> = {
	"auth/invalid-credential": "invalid-credential",
	"auth/user-not-found": "invalid-credential",
	"auth/wrong-password": "invalid-credential",
	"auth/invalid-email": "invalid-email",
	"auth/user-disabled": "user-disabled",
	"auth/email-already-in-use": "email-already-in-use",
	"auth/weak-password": "weak-password",
	"auth/popup-closed-by-user": "popup-closed",
	"auth/popup-blocked": "popup-blocked",
	"auth/network-request-failed": "network-error",
	"auth/too-many-requests": "too-many-requests",
};

/**
 * Traduce cualquier fallo a `SessionError`. Nunca deja pasar un
 * `FirebaseError` —ni su `.code`, ni su mensaje crudo— hacia el dominio.
 */
export function toSessionError(cause: unknown): SessionError {
	if (cause instanceof FirebaseError) {
		return new SessionError(CODIGOS[cause.code] ?? "unknown");
	}
	return new SessionError("unknown");
}

/**
 * Único adaptador de sesión: el resto de la aplicación conoce `SessionPort`,
 * no `Auth`.
 */
export class FirebaseSessionAdapter implements SessionPort {
	readonly #auth: Auth;

	constructor(auth: Auth) {
		this.#auth = auth;
	}

	async signIn(email: string, password: string): Promise<void> {
		try {
			await signInWithEmailAndPassword(this.#auth, email, password);
		} catch (cause) {
			throw toSessionError(cause);
		}
	}

	async signUp(email: string, password: string): Promise<void> {
		try {
			const credential = await createUserWithEmailAndPassword(
				this.#auth,
				email,
				password,
			);

			// Until they verify, this account cannot be published to the
			// directory and nobody will be able to invite them to an event:
			// registering with someone else's address is trivial, so the
			// directory demands a checked email. Google accounts arrive verified
			// and never come through here.
			//
			// A failure here does not invalidate the sign-up, which already
			// happened; the profile offers to resend.
			await sendEmailVerification(credential.user).catch(() => {});
		} catch (cause) {
			throw toSessionError(cause);
		}
	}

	async signInWithGoogle(): Promise<void> {
		try {
			// El resolver llega aquí y no en `initializeAuth`, porque arrastra
			// gapi y el iframe de autenticación: 137 KiB de tres orígenes
			// ajenos. Antes se descargaban en cada visita; ahora sólo tras este
			// clic. La importación dinámica —del mismo módulo que ya se importa
			// de forma estática arriba— es lo que aísla ese trozo del SDK en su
			// propio fragmento: importar el nombre de forma estática lo habría
			// metido en el bundle principal.
			const { browserPopupRedirectResolver } = await import("firebase/auth");
			await signInWithPopup(
				this.#auth,
				new GoogleAuthProvider(),
				browserPopupRedirectResolver,
			);
		} catch (cause) {
			throw toSessionError(cause);
		}
	}

	async signOut(): Promise<void> {
		await firebaseSignOut(this.#auth);
	}

	async sendVerificationEmail(): Promise<void> {
		const user = this.#auth.currentUser;
		if (!user) return;
		await sendEmailVerification(user);
	}

	async refreshEmailVerification(): Promise<SessionUser | null> {
		const user = this.#auth.currentUser;
		if (!user) return null;

		// `reload()` solo no basta: la regla de directorio lee
		// `request.auth.token.email_verified`, así que hay que reemitir el
		// token —`getIdToken(true)`— antes de que la verificación cuente para
		// Firestore.
		await reload(user);
		if (user.emailVerified) await user.getIdToken(true);

		return toSessionUser(user);
	}
}
