import { expect, test } from "vitest";
import { SessionError } from "./session-error.js";

test("lleva el código de dominio y nunca un mensaje del proveedor", () => {
	const error = new SessionError("invalid-credential");

	expect(error.code).toBe("invalid-credential");
	expect(error).toBeInstanceOf(Error);
	expect(error.name).toBe("SessionError");
	// There's no parameter to inject a raw message through: what can't be
	// received can't leak.
	expect(error.message).not.toContain("Firebase");
});
