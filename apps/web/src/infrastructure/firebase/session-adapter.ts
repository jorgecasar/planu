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
 * What the domain needs from Firebase's `User`, and nothing more.
 *
 * `getIdTokenResult` delegates to `user`'s real method: it's the only way
 * `SessionUser` can carry the `premium` claim (T23) without its signature
 * knowing about `firebase/auth`.
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
 * From Firebase code to domain code. Three distinct codes collapse into
 * `invalid-credential` on purpose: distinguishing them would let someone
 * find out which emails are registered. See `domain/auth-errors.test.ts`,
 * which tests the message, and this file's test, which tests the collapse.
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
 * Translates any failure into a `SessionError`. It never lets a
 * `FirebaseError` through to the domain — neither its `.code` nor its raw
 * message.
 */
export function toSessionError(cause: unknown): SessionError {
	if (cause instanceof FirebaseError) {
		return new SessionError(CODIGOS[cause.code] ?? "unknown");
	}
	return new SessionError("unknown");
}

/**
 * The one session adapter: the rest of the application knows `SessionPort`,
 * not `Auth`.
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
			// The resolver arrives here and not in `initializeAuth`, because it
			// drags in gapi and the authentication iframe: 137 KiB from three
			// third-party origins. They used to download on every visit; now
			// only after this click. The dynamic import — of the same module
			// already imported statically above — is what isolates that chunk
			// of the SDK into its own fragment: importing the name statically
			// would have put it in the main bundle.
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

		// `reload()` alone isn't enough: the directory rule reads
		// `request.auth.token.email_verified`, so the token has to be
		// reissued — `getIdToken(true)` — before the verification counts for
		// Firestore.
		await reload(user);
		if (user.emailVerified) await user.getIdToken(true);

		return toSessionUser(user);
	}
}
