import { FirebaseError } from "firebase/app";
import { expect, test } from "vitest";
import { SessionError } from "../../domain/session-error.js";
import { toSessionError, toSessionUser } from "./session-adapter.js";

// Pura y síncrona: construye los errores a mano, sin tocar el emulador de
// Auth. Es la mitad de lo que antes probaba `auth-errors.test.ts` — la que
// depende de conocer los códigos de Firebase, y por eso vive aquí y no en
// `domain/`.

test("no distingue entre usuario inexistente y contraseña errónea", () => {
	// Mensajes distintos permitirían enumerar qué correos están registrados;
	// el colapso a un único código de dominio es lo que lo impide.
	const notFound = toSessionError(new FirebaseError("auth/user-not-found", ""));
	const wrongPassword = toSessionError(
		new FirebaseError("auth/wrong-password", ""),
	);
	const invalid = toSessionError(
		new FirebaseError("auth/invalid-credential", ""),
	);

	expect(notFound.code).toBe("invalid-credential");
	expect(wrongPassword.code).toBe("invalid-credential");
	expect(invalid.code).toBe("invalid-credential");
});

test("traduce cada código conocido de Firebase a su código de dominio", () => {
	expect(toSessionError(new FirebaseError("auth/invalid-email", "")).code).toBe(
		"invalid-email",
	);
	expect(toSessionError(new FirebaseError("auth/user-disabled", "")).code).toBe(
		"user-disabled",
	);
	expect(
		toSessionError(new FirebaseError("auth/email-already-in-use", "")).code,
	).toBe("email-already-in-use");
	expect(toSessionError(new FirebaseError("auth/weak-password", "")).code).toBe(
		"weak-password",
	);
	expect(
		toSessionError(new FirebaseError("auth/popup-closed-by-user", "")).code,
	).toBe("popup-closed");
	expect(toSessionError(new FirebaseError("auth/popup-blocked", "")).code).toBe(
		"popup-blocked",
	);
	expect(
		toSessionError(new FirebaseError("auth/network-request-failed", "")).code,
	).toBe("network-error");
	expect(
		toSessionError(new FirebaseError("auth/too-many-requests", "")).code,
	).toBe("too-many-requests");
});

test("cae a 'unknown' ante un código desconocido, sin filtrar el mensaje crudo", () => {
	const error = toSessionError(
		new FirebaseError("auth/internal-error", "SECRET_INTERNAL_TRACE"),
	);

	expect(error.code).toBe("unknown");
	expect(error.message).not.toContain("SECRET_INTERNAL_TRACE");
});

test("cae a 'unknown' si la causa ni siquiera es un FirebaseError", () => {
	expect(toSessionError(new Error("boom")).code).toBe("unknown");
	expect(toSessionError("boom").code).toBe("unknown");
});

test("un SessionError construido a mano no cambia de forma", () => {
	// No hay ruta especial para reenviar un SessionError ya traducido: no la
	// necesita, porque quien llama a `toSessionError` siempre parte de la
	// causa cruda del SDK.
	expect(toSessionError(new SessionError("weak-password")).code).toBe(
		"unknown",
	);
});

test("toSessionUser sólo copia los campos que necesita el dominio", () => {
	const user = {
		uid: "u1",
		email: "ana@example.com",
		displayName: "Ana",
		photoURL: "https://example.com/ana.png",
		emailVerified: true,
	};

	const sessionUser = toSessionUser(user as never);

	expect(sessionUser).toEqual({
		uid: "u1",
		email: "ana@example.com",
		displayName: "Ana",
		photoURL: "https://example.com/ana.png",
		emailVerified: true,
		getIdTokenResult: expect.any(Function),
	});
});

test("toSessionUser delega getIdTokenResult en el user real, sin reimplementarlo", async () => {
	const claims = { premium: true };
	const user = {
		uid: "u1",
		email: null,
		displayName: null,
		photoURL: null,
		emailVerified: false,
		getIdTokenResult: () => Promise.resolve({ claims }),
	};

	const sessionUser = toSessionUser(user as never);

	// Es el propio método de Firebase, no una copia: si el SDK cambiara de
	// idea sobre cómo resolverlo, esto lo seguiría reflejando.
	await expect(sessionUser.getIdTokenResult?.()).resolves.toEqual({ claims });
});
