import { expect, test } from "vitest";
import { SessionError } from "./session-error.js";

test("lleva el código de dominio y nunca un mensaje del proveedor", () => {
	const error = new SessionError("invalid-credential");

	expect(error.code).toBe("invalid-credential");
	expect(error).toBeInstanceOf(Error);
	expect(error.name).toBe("SessionError");
	// No hay parámetro por el que inyectar un mensaje crudo: no puede filtrarse
	// lo que no se puede recibir.
	expect(error.message).not.toContain("Firebase");
});
