import { FirebaseError } from "firebase/app";
import {
	type Auth,
	createUserWithEmailAndPassword,
	deleteUser,
	EmailAuthProvider,
	signOut as firebaseSignOut,
	GoogleAuthProvider,
	reauthenticateWithCredential,
	reload,
	sendEmailVerification,
	signInWithEmailAndPassword,
	signInWithPopup,
	type User,
	verifyBeforeUpdateEmail,
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
/**
 * `providerData[0]` and not `providerId` on the user itself: Firebase's own
 * top-level `providerId` is always `"firebase"` — the umbrella, not the one
 * that actually authenticated this session. An account with no provider
 * entry (should never happen for a signed-in user) maps to `"unknown"`
 * rather than guessing.
 */
function providerOf(user: User): SessionUser["provider"] {
	const id = user.providerData[0]?.providerId;
	return id === "password" || id === "google.com" ? id : "unknown";
}

export function toSessionUser(user: User): SessionUser {
	return {
		uid: user.uid,
		email: user.email,
		displayName: user.displayName,
		photoURL: user.photoURL,
		emailVerified: user.emailVerified,
		getIdTokenResult: () => user.getIdTokenResult(),
		provider: providerOf(user),
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
	// What `verifyBeforeUpdateEmail()` raises for a malformed target address:
	// to the person it is the same mistake as at sign-up.
	"auth/invalid-new-email": "invalid-email",
	"auth/missing-new-email": "invalid-email",
	"auth/user-disabled": "user-disabled",
	"auth/email-already-in-use": "email-already-in-use",
	"auth/weak-password": "weak-password",
	"auth/popup-closed-by-user": "popup-closed",
	"auth/popup-blocked": "popup-blocked",
	"auth/network-request-failed": "network-error",
	"auth/too-many-requests": "too-many-requests",
	"auth/requires-recent-login": "requires-recent-login",
};

/**
 * Translates any failure into a `SessionError`. It never lets a
 * `FirebaseError` through to the domain — neither its `.code` nor its raw
 * message.
 */
export function toSessionError(cause: unknown): SessionError {
	// Pass through unchanged: a `SessionError` thrown deliberately by this
	// adapter — see `reauthenticate()`'s missing-password check — is already
	// domain vocabulary, and re-wrapping it here would flatten its real code
	// to "unknown" because it isn't a `FirebaseError`.
	if (cause instanceof SessionError) return cause;
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

	async reauthenticate(password?: string): Promise<void> {
		const user = this.#auth.currentUser;
		if (!user) throw new SessionError("unknown");

		try {
			const provider = providerOf(user);
			if (provider === "password") {
				if (!user.email || !password) {
					throw new SessionError("invalid-credential");
				}
				await reauthenticateWithCredential(
					user,
					EmailAuthProvider.credential(user.email, password),
				);
				return;
			}

			// `SessionUser.provider`'s own doc says "unknown" is the session an
			// adapter can't classify, treated as "no self-service deletion
			// available" rather than guessing a flow. Before this check it fell
			// through here just like Google, attempting a popup for an account
			// that may not have that provider linked at all.
			if (provider === "unknown") {
				throw new SessionError("unknown");
			}

			// Google: same isolated-chunk reasoning as signInWithGoogle() above —
			// the popup resolver only downloads once someone actually needs it.
			const { browserPopupRedirectResolver, reauthenticateWithPopup } =
				await import("firebase/auth");
			await reauthenticateWithPopup(
				user,
				new GoogleAuthProvider(),
				browserPopupRedirectResolver,
			);
		} catch (cause) {
			throw toSessionError(cause);
		}
	}

	async deleteAccount(expectedUid: string): Promise<void> {
		const user = this.#auth.currentUser;
		// Not a silent `return`: that would report success without deleting
		// anything. It can genuinely happen — the session got invalidated in
		// another tab while the deletion was in flight — and the caller needs
		// to tell that apart from a real deletion, so it doesn't announce the
		// account as gone while the Auth record still exists.
		// A different uid means another tab signed in as someone else
		// meanwhile: `currentUser` is no longer the account whose data was
		// just deleted, and deleting it would delete the wrong person (#154).
		if (!user || user.uid !== expectedUid) {
			throw new SessionError("unknown");
		}

		try {
			await deleteUser(user);
		} catch (cause) {
			throw toSessionError(cause);
		}
	}

	async changeEmail(newEmail: string): Promise<void> {
		const user = this.#auth.currentUser;
		// Same reasoning as `deleteAccount()`: a silent return would report a
		// link as sent when nothing was sent.
		if (!user) throw new SessionError("unknown");

		try {
			// Not `updateEmail()`: that switches straight away to an address
			// nobody has proven they own. This one only mails the new address,
			// and the switch — with `email_verified` set — happens on click.
			await verifyBeforeUpdateEmail(user, newEmail);
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

		try {
			// The rules read the token's `email_verified`, not the reloaded record.
			await reload(user);
			await user.getIdToken(true);
		} catch (cause) {
			throw toSessionError(cause);
		}

		return toSessionUser(user);
	}
}
