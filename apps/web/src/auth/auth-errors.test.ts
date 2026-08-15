import { FirebaseError } from "firebase/app";
import { expect, test } from "vitest";
import { authErrorMessage } from "./auth-errors.js";
import { credentialsSchema, signUpSchema } from "./schemas.js";

test("traduce los códigos conocidos de Firebase", () => {
	const error = new FirebaseError("auth/email-already-in-use", "raw");
	expect(authErrorMessage(error)).toBe("That email is already registered.");
});

test("no distingue entre usuario inexistente y contraseña errónea", () => {
	const notFound = authErrorMessage(
		new FirebaseError("auth/user-not-found", ""),
	);
	const wrongPassword = authErrorMessage(
		new FirebaseError("auth/wrong-password", ""),
	);
	const invalid = authErrorMessage(
		new FirebaseError("auth/invalid-credential", ""),
	);

	// Mensajes distintos permitirían enumerar qué correos están registrados.
	expect(notFound).toBe(wrongPassword);
	expect(wrongPassword).toBe(invalid);
});

test("cae a un mensaje genérico ante códigos desconocidos", () => {
	const error = new FirebaseError("auth/something-new", "raw");
	expect(authErrorMessage(error)).toBe(
		"Something went wrong. Please try again.",
	);
});

test("nunca filtra el mensaje crudo de Firebase", () => {
	const error = new FirebaseError(
		"auth/internal-error",
		"SECRET_INTERNAL_TRACE",
	);
	expect(authErrorMessage(error)).not.toContain("SECRET_INTERNAL_TRACE");
});

test("usa el primer problema de validación de Zod", () => {
	const result = credentialsSchema.safeParse({
		email: "no",
		password: "12345",
	});
	expect(result.success).toBe(false);
	if (!result.success) {
		expect(authErrorMessage(result.error)).toBe("Enter a valid email address.");
	}
});

test("rechaza el registro si las contraseñas no coinciden", () => {
	const result = signUpSchema.safeParse({
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
	const result = signUpSchema.safeParse({
		email: "a@b.com",
		password: "secret1",
		confirmPassword: "secret1",
	});
	expect(result.success).toBe(true);
});
