import { expect, test } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import { guardRedirect, HOME_PATH, LOGIN_PATH, PROFILE_PATH } from "./guard.js";

const signedIn: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: null,
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

const unverified: SessionUser = {
	...signedIn,
	emailVerified: false,
};

const google: SessionUser = {
	...signedIn,
	provider: "google.com",
	// Google accounts come verified from the provider itself; a `false` here
	// would not happen in practice, but the guard still shouldn't need it —
	// see the dedicated test below.
};

test("la aplicación vive bajo /app, no en la raíz", () => {
	// The root stays free for the public landing, which does not start the
	// application or the Firebase SDK.
	expect(HOME_PATH).toBe("/app");
	expect(LOGIN_PATH).toBe("/app/login");
	expect(PROFILE_PATH).toBe("/app/profile");
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

test("sin verificar en una ruta cualquiera redirige al perfil", () => {
	expect(guardRedirect(unverified, "/app")).toBe(PROFILE_PATH);
	expect(guardRedirect(unverified, "/app/some-other-route")).toBe(PROFILE_PATH);
});

test("sin verificar y ya en el perfil no reencamina, para no entrar en bucle", () => {
	expect(guardRedirect(unverified, PROFILE_PATH)).toBeNull();
});

test("sin verificar en el login no interfiere con su propio flujo", () => {
	// The login route keeps its existing, unrelated behaviour — signed in
	// sends to home — regardless of verification. Verification is resolved
	// once the user actually lands on a route past the login.
	expect(guardRedirect(unverified, LOGIN_PATH)).toBe(HOME_PATH);
});

test("verificado, sin cambios respecto al comportamiento existente", () => {
	expect(guardRedirect(signedIn, "/app")).toBeNull();
	expect(guardRedirect(signedIn, "/app/profile")).toBeNull();
	expect(guardRedirect(signedIn, "/app/login")).toBe(HOME_PATH);
});

test("cuenta de Google, verificada de fábrica, sin fricción", () => {
	expect(guardRedirect(google, "/app")).toBeNull();
	expect(guardRedirect(google, "/app/some-other-route")).toBeNull();
});

test("sesión undefined nunca redirige, ni con email sin verificar", () => {
	expect(guardRedirect(undefined, "/app/some-other-route")).toBeNull();
});
