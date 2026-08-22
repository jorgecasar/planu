import { expect, test, vi } from "vitest";
import { SessionError } from "../domain/session-error.js";
import { deleteAccount } from "./delete-account.js";
import type {
	AccountDataPort,
	AccountEventSummary,
} from "./ports/account-data.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

function fakeSession(): SessionPort {
	return {
		signIn: vi.fn(),
		signUp: vi.fn(),
		signInWithGoogle: vi.fn(),
		signOut: vi.fn(),
		sendVerificationEmail: vi.fn(),
		refreshEmailVerification: vi.fn(),
		reauthenticate: vi.fn().mockResolvedValue(undefined),
		deleteAccount: vi.fn().mockResolvedValue(undefined),
	};
}

function fakeAccount(events: AccountEventSummary[] = []): AccountDataPort {
	return {
		listMemberEvents: vi.fn().mockResolvedValue(events),
		deleteOwnEvent: vi.fn().mockResolvedValue(undefined),
		leaveEvent: vi.fn().mockResolvedValue(undefined),
		deleteEventImage: vi.fn().mockResolvedValue(undefined),
		deleteDirectoryEntries: vi.fn().mockResolvedValue(undefined),
	};
}

const USER: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

test("sin eventos, borra el directorio y la cuenta, y nada más", async () => {
	const session = fakeSession();
	const account = fakeAccount([]);

	await deleteAccount(session, account, USER);

	expect(account.listMemberEvents).toHaveBeenCalledWith("u1");
	expect(account.deleteOwnEvent).not.toHaveBeenCalled();
	expect(account.leaveEvent).not.toHaveBeenCalled();
	expect(account.deleteEventImage).not.toHaveBeenCalled();
	expect(account.deleteDirectoryEntries).toHaveBeenCalledWith(
		"u1",
		"ana@example.com",
	);
	expect(session.deleteAccount).toHaveBeenCalledOnce();
});

test("un evento propio con imagen: la imagen se borra antes que el evento", async () => {
	const order: string[] = [];
	const account = fakeAccount([
		{ id: "e1", isOwner: true, imageUrl: "https://example.com/e1.png" },
	]);
	vi.mocked(account.deleteEventImage).mockImplementation(async () => {
		order.push("image");
	});
	vi.mocked(account.deleteOwnEvent).mockImplementation(async () => {
		order.push("event");
	});

	await deleteAccount(fakeSession(), account, USER);

	expect(account.deleteEventImage).toHaveBeenCalledWith(
		"https://example.com/e1.png",
	);
	expect(account.deleteOwnEvent).toHaveBeenCalledWith("e1");
	expect(account.leaveEvent).not.toHaveBeenCalled();
	// The order is what matters, not just that both were called: deleteAccount()'s
	// own comment explains why the image has to go first.
	expect(order).toEqual(["image", "event"]);
});

test("un evento propio sin imagen no intenta borrar ninguna", async () => {
	const account = fakeAccount([{ id: "e1", isOwner: true }]);

	await deleteAccount(fakeSession(), account, USER);

	expect(account.deleteEventImage).not.toHaveBeenCalled();
	expect(account.deleteOwnEvent).toHaveBeenCalledWith("e1");
});

test("un evento ajeno se abandona, nunca se borra ni se le toca la imagen", async () => {
	const account = fakeAccount([
		{ id: "e2", isOwner: false, imageUrl: "https://example.com/e2.png" },
	]);

	await deleteAccount(fakeSession(), account, USER);

	expect(account.leaveEvent).toHaveBeenCalledWith("e2", "u1");
	expect(account.deleteOwnEvent).not.toHaveBeenCalled();
	expect(account.deleteEventImage).not.toHaveBeenCalled();
});

test("una mezcla de eventos propios y ajenos trata cada uno por su cuenta", async () => {
	const account = fakeAccount([
		{ id: "own", isOwner: true },
		{ id: "guest", isOwner: false },
	]);

	await deleteAccount(fakeSession(), account, USER);

	expect(account.deleteOwnEvent).toHaveBeenCalledWith("own");
	expect(account.leaveEvent).toHaveBeenCalledWith("guest", "u1");
});

test("informa del progreso en el orden que T32 fija: listar, eventos, directorio, cuenta", async () => {
	const account = fakeAccount([
		{ id: "e1", isOwner: true },
		{ id: "e2", isOwner: false },
	]);
	const steps: string[] = [];

	await deleteAccount(fakeSession(), account, USER, (step) => {
		steps.push(step.phase);
	});

	expect(steps).toEqual([
		"listing",
		"deleting-events",
		"deleting-events",
		"deleting-directory",
		"deleting-account",
	]);
});

test("el progreso de borrado de eventos cuenta done/total correctamente", async () => {
	const account = fakeAccount([
		{ id: "e1", isOwner: true },
		{ id: "e2", isOwner: true },
	]);
	const progress: Array<{ done: number; total: number }> = [];

	await deleteAccount(fakeSession(), account, USER, (step) => {
		if (step.phase === "deleting-events") {
			progress.push({ done: step.done, total: step.total });
		}
	});

	expect(progress).toEqual([
		{ done: 0, total: 2 },
		{ done: 1, total: 2 },
	]);
});

test("si el borrado de la cuenta exige reautenticación, se propaga sin envolver", async () => {
	const session = fakeSession();
	vi.mocked(session.deleteAccount).mockRejectedValue(
		new SessionError("requires-recent-login"),
	);

	await expect(
		deleteAccount(session, fakeAccount([]), USER),
	).rejects.toMatchObject({ code: "requires-recent-login" });

	// Everything before this already ran: a retry after reauthenticating
	// repeats nothing because there's nothing left to repeat.
	expect(session.deleteAccount).toHaveBeenCalledOnce();
});

test("un reintento tras una interrupción a mitad no repite lo ya borrado", async () => {
	// Simulates the interruption by having the second attempt list only what
	// would genuinely be left: an already-deleted event doesn't reappear in
	// `listMemberEvents`, so the use case doesn't need to know there was an
	// earlier attempt.
	const account = fakeAccount([{ id: "e2", isOwner: false }]);
	const session = fakeSession();

	await deleteAccount(session, account, USER);

	expect(account.leaveEvent).toHaveBeenCalledOnce();
	expect(account.deleteOwnEvent).not.toHaveBeenCalled();
	expect(session.deleteAccount).toHaveBeenCalledOnce();
});

test("un usuario sin email todavía borra su entrada del directorio con null", async () => {
	// `SessionUser.email` is nullable — an account that signed up but never
	// confirmed an address, for instance. `deleteDirectoryEntries` has to
	// accept that shape too, not just the common case.
	const account = fakeAccount([]);
	const guest: SessionUser = { ...USER, email: null };

	await deleteAccount(fakeSession(), account, guest);

	expect(account.deleteDirectoryEntries).toHaveBeenCalledWith("u1", null);
});
