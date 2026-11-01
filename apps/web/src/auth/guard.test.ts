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

const noEmail: SessionUser = {
	...unverified,
	email: null,
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

test("sin verificar, el login lleva directo al perfil, sin pasar por la portada", () => {
	// Via home it would be two history entries — Back bounces off the
	// profile — and the events view would start loading for an account that
	// can't use it.
	expect(guardRedirect(unverified, LOGIN_PATH)).toBe(PROFILE_PATH);
});

test("una cuenta sin email no tiene nada que verificar y no se reencamina", () => {
	// Otherwise it would be sent to a notice that can never resolve.
	expect(guardRedirect(noEmail, "/app")).toBeNull();
	expect(guardRedirect(noEmail, LOGIN_PATH)).toBe(HOME_PATH);
});

test("verificado, sin cambios respecto al comportamiento existente", () => {
	expect(guardRedirect(signedIn, "/app")).toBeNull();
	expect(guardRedirect(signedIn, "/app/profile")).toBeNull();
	expect(guardRedirect(signedIn, "/app/login")).toBe(HOME_PATH);
});

test("el proveedor no exime: sólo cuenta emailVerified", () => {
	// Google accounts arrive verified, so they pass through the verified case
	// above. What this pins is that the guard never shortcuts on the
	// provider: an unverified token is redirected whatever signed it in.
	expect(guardRedirect({ ...unverified, provider: "google.com" }, "/app")).toBe(
		PROFILE_PATH,
	);
});

test("mientras se comprueba la sesión, tampoco reencamina desde una ruta cualquiera", () => {
	expect(guardRedirect(undefined, "/app/some-other-route")).toBeNull();
});
