/**
 * La sesión actual, en lo mínimo que la aplicación necesita hoy.
 *
 * Ni `Auth` ni el `User` de Firebase: sólo los campos que de verdad leen
 * `app-shell.ts` (cabecera), `profile-view.ts` (ficha y aviso de
 * verificación) y los componentes que ya consumían la sesión —`sharing/` y
 * los de `events/`— (`.uid`, `.email`, `.displayName`, `.photoURL`).
 * Ampliar esta forma es legítimo el día que algo más lo necesite; no antes.
 */
export interface SessionUser {
	uid: string;
	email: string | null;
	displayName: string | null;
	photoURL: string | null;
	emailVerified: boolean;
	/**
	 * Claims personalizados del token — hoy sólo el `premium` que resuelve
	 * `ai-policy.ts` para la IA en la nube (T23; ver `ai-model-session.ts`).
	 * Opcional porque no todo adaptador puede resolverlos, y porque hacerlo
	 * obligatorio filtraría la forma de `firebase/auth`'s `User` en esta
	 * interfaz en vez de sólo lo que un caso de uso puntual necesita.
	 */
	getIdTokenResult?: () => Promise<{ claims: Record<string, unknown> }>;
}

/**
 * Lo que la aplicación necesita para gestionar la sesión. Firebase es un
 * detalle de `infrastructure/`: nada de `Auth`, `User` ni `FirebaseError`
 * cruza esta frontera.
 *
 * Fino y por operación, no un espejo del SDK — no hay `onAuthStateChanged`
 * aquí porque observar la sesión sigue siendo responsabilidad de quien
 * publica el contexto, no de este puerto.
 *
 * Todo método que falla lo hace con un `SessionError` de
 * `domain/session-error.ts`, nunca con el error crudo del proveedor.
 */
export interface SessionPort {
	signIn(email: string, password: string): Promise<void>;

	/**
	 * Crea la cuenta y, si el proveedor lo permite, envía el correo de
	 * verificación. Un fallo al enviarlo no invalida el alta, que ya ocurrió.
	 */
	signUp(email: string, password: string): Promise<void>;

	signInWithGoogle(): Promise<void>;

	signOut(): Promise<void>;

	/** Reenvía el correo de verificación a la cuenta con sesión abierta. */
	sendVerificationEmail(): Promise<void>;

	/**
	 * Refresca el estado de verificación contra el proveedor y devuelve el
	 * usuario actualizado, o `null` si ya no hay sesión.
	 *
	 * No es un simple `reload()`: cuando el correo ya está verificado, también
	 * renueva el token de identidad, que es lo que hace falta para que las
	 * reglas de Firestore vean `email_verified` al día.
	 */
	refreshEmailVerification(): Promise<SessionUser | null>;
}
