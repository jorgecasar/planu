import { FirebaseError } from "firebase/app";
import { deleteUser, reload, verifyBeforeUpdateEmail } from "firebase/auth";
import { expect, test, vi } from "vitest";
import { SessionError } from "../../domain/session-error.js";
import {
	FirebaseSessionAdapter,
	toSessionError,
	toSessionUser,
} from "./session-adapter.js";

// Only `verifyBeforeUpdateEmail`, `reload` and `deleteUser` are replaced, so
// they run without a network round trip; every other export stays real.
vi.mock("firebase/auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("firebase/auth")>()),
	verifyBeforeUpdateEmail: vi.fn(),
	reload: vi.fn(),
	deleteUser: vi.fn(),
}));

// Pure and synchronous: builds the errors by hand, without touching the
// Auth emulator. It's half of what `auth-errors.test.ts` used to test — the
// half that depends on knowing Firebase's codes, and that's why it lives
// here and not in `domain/`.

test("no distingue entre usuario inexistente y contraseña errónea", () => {
	// Distinct messages would let someone enumerate which emails are
	// registered; collapsing to a single domain code is what prevents it.
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

test("un SessionError construido a mano pasa intacto, sin reenvolverse", () => {
	// T32's reauthenticate() throws a SessionError directly for the
	// missing-password case, and its own try/catch calls toSessionError on
	// whatever it catches — including that SessionError. Without this
	// pass-through, the real code would flatten to "unknown" because it
	// isn't a FirebaseError, and the caller would never see
	// "invalid-credential".
	expect(toSessionError(new SessionError("weak-password")).code).toBe(
		"weak-password",
	);
});

test("toSessionUser sólo copia los campos que necesita el dominio", () => {
	const user = {
		uid: "u1",
		email: "ana@example.com",
		displayName: "Ana",
		photoURL: "https://example.com/ana.png",
		emailVerified: true,
		providerData: [{ providerId: "password" }],
	};

	const sessionUser = toSessionUser(user as never);

	expect(sessionUser).toEqual({
		uid: "u1",
		email: "ana@example.com",
		displayName: "Ana",
		photoURL: "https://example.com/ana.png",
		emailVerified: true,
		getIdTokenResult: expect.any(Function),
		provider: "password",
	});
});

test('toSessionUser resuelve provider a "unknown" si providerData no lo reconoce', () => {
	const user = {
		uid: "u1",
		email: null,
		displayName: null,
		photoURL: null,
		emailVerified: false,
		providerData: [],
	};

	expect(toSessionUser(user as never).provider).toBe("unknown");
});

test("toSessionUser distingue una cuenta de Google, no sólo password", () => {
	const user = {
		uid: "u1",
		email: "ana@gmail.com",
		displayName: "Ana",
		photoURL: null,
		emailVerified: true,
		providerData: [{ providerId: "google.com" }],
	};

	expect(toSessionUser(user as never).provider).toBe("google.com");
});

test("toSessionUser delega getIdTokenResult en el user real, sin reimplementarlo", async () => {
	const claims = { premium: true };
	const user = {
		uid: "u1",
		email: null,
		displayName: null,
		photoURL: null,
		emailVerified: false,
		providerData: [],
		getIdTokenResult: () => Promise.resolve({ claims }),
	};

	const sessionUser = toSessionUser(user as never);

	// It's Firebase's own method, not a copy: if the SDK changed its mind
	// about how to resolve it, this would keep reflecting that.
	await expect(sessionUser.getIdTokenResult?.()).resolves.toEqual({ claims });
});

test("deleteAccount() no reporta éxito si ya no hay sesión: lanza en vez de devolver en silencio", async () => {
	// The session may have been invalidated in another tab while the
	// deletion was in flight. A silent `return` there would report an
	// account as deleted when the Auth record can still exist — a finding
	// from T32's security audit.
	const adapter = new FirebaseSessionAdapter({ currentUser: null } as never);

	await expect(adapter.deleteAccount("u1")).rejects.toMatchObject({
		code: "unknown",
	});
	expect(deleteUser).not.toHaveBeenCalled();
});

test("deleteAccount() no borra a otro usuario si la sesión cambió de uid a mitad del borrado", async () => {
	// Another tab signed in as someone else after the use case verified "u1":
	// deleting `currentUser` then would delete the wrong account (#154).
	vi.mocked(deleteUser).mockClear();
	const adapter = new FirebaseSessionAdapter({
		currentUser: { uid: "u2" },
	} as never);

	await expect(adapter.deleteAccount("u1")).rejects.toMatchObject({
		code: "unknown",
	});
	expect(deleteUser).not.toHaveBeenCalled();
});

test("deleteAccount() borra el usuario actual si es el uid verificado", async () => {
	vi.mocked(deleteUser).mockClear().mockResolvedValueOnce(undefined);
	const user = { uid: "u1" };
	const adapter = new FirebaseSessionAdapter({ currentUser: user } as never);

	await adapter.deleteAccount("u1");

	expect(deleteUser).toHaveBeenCalledExactlyOnceWith(user);
});

test("reauthenticate() no intenta un popup de Google para un proveedor sin clasificar", async () => {
	// `SessionUser.provider`'s doc says "unknown" is treated as "no
	// self-service deletion available," not as if it were Google. Before
	// this check it fell through to the Google branch and attempted a popup
	// for an account that may not have that provider linked — same audit
	// finding.
	const user = { providerData: [{ providerId: "phone" }] };
	const adapter = new FirebaseSessionAdapter({
		currentUser: user,
	} as never);

	await expect(adapter.reauthenticate()).rejects.toMatchObject({
		code: "unknown",
	});
});

test("los códigos de verifyBeforeUpdateEmail para una dirección inválida se traducen a invalid-email", () => {
	expect(
		toSessionError(new FirebaseError("auth/invalid-new-email", "")).code,
	).toBe("invalid-email");
	expect(
		toSessionError(new FirebaseError("auth/missing-new-email", "")).code,
	).toBe("invalid-email");
	expect(
		toSessionError(new FirebaseError("auth/requires-recent-login", "")).code,
	).toBe("requires-recent-login");
});

test("changeEmail() manda el enlace a la dirección nueva, no cambia el email directamente", async () => {
	const user = { uid: "u1" };
	const adapter = new FirebaseSessionAdapter({ currentUser: user } as never);
	vi.mocked(verifyBeforeUpdateEmail).mockResolvedValueOnce(undefined);

	await adapter.changeEmail("ana@example.com");

	expect(verifyBeforeUpdateEmail).toHaveBeenCalledWith(user, "ana@example.com");
});

test("changeEmail() traduce el fallo del proveedor a SessionError, sin filtrar el mensaje crudo", async () => {
	const adapter = new FirebaseSessionAdapter({
		currentUser: { uid: "u1" },
	} as never);
	vi.mocked(verifyBeforeUpdateEmail).mockRejectedValueOnce(
		new FirebaseError("auth/requires-recent-login", "SECRET_TRACE"),
	);

	const error = await adapter.changeEmail("ana@example.com").catch((e) => e);

	expect(error).toBeInstanceOf(SessionError);
	expect(error.code).toBe("requires-recent-login");
	expect(error.message).not.toContain("SECRET_TRACE");
});

test("changeEmail() no reporta éxito si ya no hay sesión", async () => {
	const adapter = new FirebaseSessionAdapter({ currentUser: null } as never);

	await expect(adapter.changeEmail("ana@example.com")).rejects.toMatchObject({
		code: "unknown",
	});
});

test.each([true, false])(
	"refreshEmailVerification() renueva el token (emailVerified %s)",
	async (emailVerified) => {
		const user = {
			uid: "u1",
			email: "ana@example.com",
			emailVerified,
			providerData: [],
			getIdToken: vi.fn().mockResolvedValue("t"),
		};
		vi.mocked(reload).mockResolvedValueOnce(undefined);
		const adapter = new FirebaseSessionAdapter({ currentUser: user } as never);

		const refreshed = await adapter.refreshEmailVerification();

		expect(reload).toHaveBeenCalledWith(user);
		expect(user.getIdToken).toHaveBeenCalledWith(true);
		expect(refreshed?.emailVerified).toBe(emailVerified);
	},
);

test("refreshEmailVerification() traduce el fallo del proveedor a SessionError", async () => {
	vi.mocked(reload).mockRejectedValueOnce(
		new FirebaseError("auth/network-request-failed", "SECRET_TRACE"),
	);
	const adapter = new FirebaseSessionAdapter({
		currentUser: { uid: "u1", getIdToken: vi.fn() },
	} as never);

	const error = await adapter.refreshEmailVerification().catch((e) => e);

	expect(error).toBeInstanceOf(SessionError);
	expect(error.code).toBe("network-error");
	expect(error.message).not.toContain("SECRET_TRACE");
});
