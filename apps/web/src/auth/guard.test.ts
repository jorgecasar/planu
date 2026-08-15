import type { User } from "firebase/auth";
import { expect, test } from "vitest";
import { guardRedirect } from "./guard.js";

const signedIn = { uid: "u1" } as User;

test("mientras se comprueba la sesión no reencamina a ningún sitio", () => {
	// Si esto devolviera /login, un usuario con sesión válida vería el formulario
	// de acceso durante el arranque.
	expect(guardRedirect(undefined, "/")).toBeNull();
	expect(guardRedirect(undefined, "/login")).toBeNull();
	expect(guardRedirect(undefined, "/profile")).toBeNull();
});

test("sin sesión, cualquier ruta privada lleva al login", () => {
	expect(guardRedirect(null, "/")).toBe("/login");
	expect(guardRedirect(null, "/profile")).toBe("/login");
});

test("sin sesión, el login se queda donde está", () => {
	expect(guardRedirect(null, "/login")).toBeNull();
});

test("con sesión, el login redirige a la portada", () => {
	expect(guardRedirect(signedIn, "/login")).toBe("/");
});

test("con sesión, las rutas privadas se dejan en paz", () => {
	expect(guardRedirect(signedIn, "/")).toBeNull();
	expect(guardRedirect(signedIn, "/profile")).toBeNull();
});
