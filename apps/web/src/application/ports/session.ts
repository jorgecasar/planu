/**
 * The current session, in the minimum shape the application needs today.
 *
 * Neither `Auth` nor Firebase's `User`: only the fields that `app-shell.ts`
 * (header), `profile-view.ts` (card and verification notice) and the
 * components that already consumed the session — `sharing/` and the ones
 * under `events/` — actually read (`.uid`, `.email`, `.displayName`,
 * `.photoURL`). Widening this shape is legitimate the day something else
 * needs it; not before.
 */
export interface SessionUser {
	uid: string;
	email: string | null;
	displayName: string | null;
	photoURL: string | null;
	emailVerified: boolean;
	/**
	 * Custom token claims — today only the `premium` one that `ai-policy.ts`
	 * resolves for cloud AI (T23; see `ai-model-session.ts`). Optional
	 * because not every adapter can resolve them, and because making it
	 * mandatory would leak the shape of `firebase/auth`'s `User` into this
	 * interface instead of just what a single use case needs.
	 */
	getIdTokenResult?: () => Promise<{ claims: Record<string, unknown> }>;
	/**
	 * How this session signed in. T32 needs it to know which credential
	 * `reauthenticate()` requires: a password for `"password"`, nothing for
	 * `"google.com"` — `reauthenticateWithPopup` carries its own. `"unknown"`
	 * covers a session an adapter can't classify, which the UI treats as "no
	 * self-service deletion available" rather than guessing a flow.
	 */
	provider: "password" | "google.com" | "unknown";
}

/**
 * What the application needs to manage the session. Firebase is an
 * `infrastructure/` detail: no `Auth`, `User`, or `FirebaseError` crosses
 * this boundary.
 *
 * Thin and per-operation, not a mirror of the SDK — there's no
 * `onAuthStateChanged` here because observing the session is still the
 * responsibility of whoever publishes the context, not of this port.
 *
 * Every method that fails does so with a `SessionError` from
 * `domain/session-error.ts`, never with the provider's raw error.
 */
export interface SessionPort {
	signIn(email: string, password: string): Promise<void>;

	/**
	 * Proves the session is fresh enough for a sensitive operation.
	 *
	 * `password` is required and used only when `SessionUser.provider` is
	 * `"password"`; for `"google.com"` the adapter reauthenticates through a
	 * popup instead and ignores it. Rejects with `SessionError`
	 * `"invalid-credential"` on a wrong password, same as `signIn`.
	 */
	reauthenticate(password?: string): Promise<void>;

	/**
	 * Deletes the Auth account itself — the last step of T32's account
	 * deletion, after every Firestore and Storage record tied to it is gone.
	 * Rejects with `SessionError` `"requires-recent-login"` if the session
	 * is too old; the caller is expected to call `reauthenticate()` and
	 * retry, not to reauthenticate on its behalf.
	 */
	deleteAccount(): Promise<void>;

	/**
	 * Creates the account and, if the provider allows it, sends the
	 * verification email. A failure to send it doesn't invalidate the
	 * sign-up, which already happened.
	 */
	signUp(email: string, password: string): Promise<void>;

	signInWithGoogle(): Promise<void>;

	signOut(): Promise<void>;

	/** Resends the verification email to the currently signed-in account. */
	sendVerificationEmail(): Promise<void>;

	/**
	 * Refreshes the verification status against the provider and returns
	 * the updated user, or `null` if there is no longer a session.
	 *
	 * Not a plain `reload()`: when the email is already verified, it also
	 * renews the identity token, which is what's needed for Firestore rules
	 * to see an up-to-date `email_verified`.
	 */
	refreshEmailVerification(): Promise<SessionUser | null>;
}
