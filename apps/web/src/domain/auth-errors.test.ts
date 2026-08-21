import { expect, test } from "vitest";
import { credentialsSchema, signUpSchema } from "../auth/schemas.js";
import { authErrorMessage } from "./auth-errors.js";
import { SessionError } from "./session-error.js";

// El colapso de "usuario inexistente", "contraseña errónea" y "credencial
// inválida" en un único código ya ha ocurrido para cuando `authErrorMessage`
// se ejecuta: eso lo prueba `infrastructure/firebase/session-adapter.test.ts`,
// donde vive la traducción de los códigos crudos de Firebase. Aquí sólo
// importa que ese código de dominio produzca el mensaje correcto.

test("traduce cada código de dominio conocido", () => {
	expect(authErrorMessage(new SessionError("invalid-credential"))).toBe(
		"Wrong email or password.",
	);
	expect(authErrorMessage(new SessionError("invalid-email"))).toBe(
		"Enter a valid email address.",
	);
	expect(authErrorMessage(new SessionError("user-disabled"))).toBe(
		"This account has been disabled.",
	);
	expect(authErrorMessage(new SessionError("email-already-in-use"))).toBe(
		"That email is already registered.",
	);
	expect(authErrorMessage(new SessionError("weak-password"))).toBe(
		"Password must be at least 6 characters.",
	);
	expect(authErrorMessage(new SessionError("popup-closed"))).toBe(
		"The Google sign-in window was closed.",
	);
	expect(authErrorMessage(new SessionError("popup-blocked"))).toBe(
		"Your browser blocked the sign-in window.",
	);
	expect(authErrorMessage(new SessionError("network-error"))).toBe(
		"Network error. Check your connection.",
	);
	expect(authErrorMessage(new SessionError("too-many-requests"))).toBe(
		"Too many attempts. Try again in a few minutes.",
	);
});

test("cae a un mensaje genérico ante un código de dominio desconocido", () => {
	expect(authErrorMessage(new SessionError("unknown"))).toBe(
		"Something went wrong. Please try again.",
	);
});

test("cae al mismo mensaje genérico ante cualquier otra causa", () => {
	expect(authErrorMessage(new Error("boom"))).toBe(
		"Something went wrong. Please try again.",
	);
	expect(authErrorMessage("boom")).toBe(
		"Something went wrong. Please try again.",
	);
});

test("usa el primer problema de validación de Zod", () => {
	const result = credentialsSchema().safeParse({
		email: "no",
		password: "12345",
	});
	expect(result.success).toBe(false);
	if (!result.success) {
		expect(authErrorMessage(result.error)).toBe("Enter a valid email address.");
	}
});

test("rechaza el registro si las contraseñas no coinciden", () => {
	const result = signUpSchema().safeParse({
		email: "a@b.com",
		password: "secret1",
		confirmPassword: "secret2",
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(authErrorMessage(result.error)).toBe("Passwords don't match.");
	}
});

test("acepta un registro válido", () => {
	const result = signUpSchema().safeParse({
		email: "a@b.com",
		password: "secret1",
		confirmPassword: "secret1",
	});
	expect(result.success).toBe(true);
});
