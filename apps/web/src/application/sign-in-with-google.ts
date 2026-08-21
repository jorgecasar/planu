import type { SessionPort } from "./ports/session.js";

/**
 * Sin validación propia: Google no pide credenciales que comprobar aquí. La
 * costura sigue mereciendo la pena porque es lo que permite al componente
 * dejar de construir un `GoogleAuthProvider`.
 */
export function signInWithGoogle(session: SessionPort): Promise<void> {
	return session.signInWithGoogle();
}
