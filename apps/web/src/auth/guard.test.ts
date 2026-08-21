import { expect, test } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import { guardRedirect, HOME_PATH, LOGIN_PATH } from "./guard.js";

const signedIn: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: null,
	photoURL: null,
	emailVerified: true,
};

test("la aplicación vive bajo /app, no en la raíz", () => {
	// The root stays free for the public landing, which does not start the
	// application or the Firebase SDK.
	expect(HOME_PATH).toBe("/app");
	expect(LOGIN_PATH).toBe("/app/login");
});

test("mientras se comprueba la sesión no reencamina a ningún sitio", () => {
	// If this returned the login, a user with a valid session would see the
	// sign-in form during startup.
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
