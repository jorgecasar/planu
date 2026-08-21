/**
 * Fallo de sesión, ya traducido del proveedor.
 *
 * `application/ports/session.ts` documenta que sus métodos rechazan con esto,
 * nunca con el error crudo del SDK. El adaptador de `infrastructure/` es quien
 * hace la traducción — sabe qué código de Firebase corresponde a cada uno de
 * éstos; `domain/auth-errors.ts` sólo conoce estos códigos y nunca `FirebaseError`.
 */
export type SessionErrorCode =
	| "invalid-credential"
	| "invalid-email"
	| "user-disabled"
	| "email-already-in-use"
	| "weak-password"
	| "popup-closed"
	| "popup-blocked"
	| "network-error"
	| "too-many-requests"
	| "unknown";

/**
 * No lleva el mensaje crudo del proveedor: se construye sólo a partir del
 * código, así que no hay manera de que un texto sensible del SDK viaje dentro
 * de esta excepción hasta la interfaz.
 */
export class SessionError extends Error {
	constructor(readonly code: SessionErrorCode) {
		super(`session error: ${code}`);
		this.name = "SessionError";
	}
}
