import type { User } from "firebase/auth";
import { expect, test } from "vitest";
import { guardRedirect, HOME_PATH, LOGIN_PATH } from "./guard.js";

const signedIn = { uid: "u1" } as User;

test("la aplicación vive bajo /app, no en la raíz", () => {
	// La raíz queda libre para la landing pública, que no arranca la aplicación
	// ni el SDK de Firebase.
	expect(HOME_PATH).toBe("/app");
	expect(LOGIN_PATH).toBe("/app/login");
});

test("mientras se comprueba la sesión no reencamina a ningún sitio", () => {
	// Si esto devolviera el login, un usuario con sesión válida vería el
	// formulario de acceso durante el arranque.
	expect(guardRedirect(undefined, "/app")).toBeNull();
	expect(guardRedirect(undefined, "/app/login")).toBeNull();
	expect(guardRedirect(undefined, "/app/profile")).toBeNull();
});

test("sin sesión, cualquier ruta privada lleva al login", () => {
	expect(guardRedirect(null, "/app")).toBe("/app/login");
	expect(guardRedirect(null, "/app/profile")).toBe("/app/login");
});

test("sin sesión, el login se queda donde está", () => {
	expect(guardRedirect(null, "/app/login")).toBeNull();
});

test("con sesión, el login redirige a la portada de la aplicación", () => {
	expect(guardRedirect(signedIn, "/app/login")).toBe("/app");
});

test("con sesión, las rutas privadas se dejan en paz", () => {
	expect(guardRedirect(signedIn, "/app")).toBeNull();
	expect(guardRedirect(signedIn, "/app/profile")).toBeNull();
});
