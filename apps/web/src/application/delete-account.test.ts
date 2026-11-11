import { expect, test, vi } from "vitest";
import { SessionError } from "../domain/session-error.js";
import { deleteAccount } from "./delete-account.js";
import type {
	AccountDataPort,
	AccountEventSummary,
} from "./ports/account-data.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

/** `refreshed` is what the fresh read returns: the user under test by default. */
function fakeSession(refreshed: SessionUser | null = USER): SessionPort {
	return {
		signIn: vi.fn(),
		signUp: vi.fn(),
		signInWithGoogle: vi.fn(),
		signOut: vi.fn(),
		sendVerificationEmail: vi.fn(),
		refreshEmailVerification: vi.fn().mockResolvedValue(refreshed),
		reauthenticate: vi.fn().mockResolvedValue(undefined),
		deleteAccount: vi.fn().mockResolvedValue(undefined),
		changeEmail: vi.fn().mockResolvedValue(undefined),
	};
}

function fakeAccount(events: AccountEventSummary[] = []): AccountDataPort {
	return {
		listMemberEvents: vi.fn().mockResolvedValue(events),
		deleteOwnEvent: vi.fn().mockResolvedValue(undefined),
		leaveEvent: vi.fn().mockResolvedValue(undefined),
		deleteEventImage: vi.fn().mockResolvedValue(undefined),
		deleteAllEventImages: vi.fn().mockResolvedValue(undefined),
		deleteDirectoryEntries: vi.fn().mockResolvedValue(undefined),
		deleteReceivedInvitations: vi.fn().mockResolvedValue(undefined),
		deleteSentInvitations: vi.fn().mockResolvedValue(undefined),
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

test("pasa al puerto el uid verificado al empezar, para que no borre otra sesión", async () => {
	const session = fakeSession();

	await deleteAccount(session, fakeAccount([]), USER);

	expect(session.deleteAccount).toHaveBeenCalledExactlyOnceWith("u1");
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
		"u1",
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

	await deleteAccount(fakeSession(guest), account, guest);

	expect(account.deleteDirectoryEntries).toHaveBeenCalledWith("u1", null);
});

test("barre la carpeta de imágenes después de los eventos", async () => {
	// Catches uploads no event points to — an image whose event was never
	// saved — which deleting per event would leave behind.
	const order: string[] = [];
	const account = fakeAccount([{ id: "e1", isOwner: true }]);
	vi.mocked(account.deleteOwnEvent).mockImplementation(async () => {
		order.push("event");
	});
	vi.mocked(account.deleteAllEventImages).mockImplementation(async () => {
		order.push("folder");
	});
	vi.mocked(account.deleteDirectoryEntries).mockImplementation(async () => {
		order.push("directory");
	});

	await deleteAccount(fakeSession(), account, USER);

	expect(account.deleteAllEventImages).toHaveBeenCalledWith("u1");
	expect(order).toEqual(["event", "folder", "directory"]);
});

test("si falla el barrido de la carpeta, no borra la cuenta", async () => {
	const session = fakeSession();
	const account = fakeAccount([{ id: "e1", isOwner: true }]);
	vi.mocked(account.deleteAllEventImages).mockRejectedValue(new Error("z"));

	await expect(deleteAccount(session, account, USER)).rejects.toThrow("z");
	expect(account.deleteDirectoryEntries).toHaveBeenCalledOnce();
	expect(session.deleteAccount).not.toHaveBeenCalled();
});

test("tras un fallo a medias, el reintento termina el borrado", async () => {
	const session = fakeSession();
	const account = fakeAccount([]);
	vi.mocked(account.deleteAllEventImages).mockRejectedValueOnce(new Error("z"));

	await expect(deleteAccount(session, account, USER)).rejects.toThrow("z");
	await deleteAccount(session, account, USER);

	expect(account.deleteAllEventImages).toHaveBeenCalledTimes(2);
	expect(session.deleteAccount).toHaveBeenCalledOnce();
});

test("si fallan el barrido y el directorio, rechaza una sola vez", async () => {
	const session = fakeSession();
	const account = fakeAccount([]);
	vi.mocked(account.deleteAllEventImages).mockRejectedValue(new Error("z"));
	vi.mocked(account.deleteDirectoryEntries).mockRejectedValue(new Error("y"));

	await expect(deleteAccount(session, account, USER)).rejects.toThrow("z");
	expect(session.deleteAccount).not.toHaveBeenCalled();
});

const UNVERIFIED: SessionUser = { ...USER, emailVerified: false };
const FIXED: SessionUser = { ...USER, email: "ana.fixed@example.com" };

// The snapshot can be stale either way; the fresh read decides the path.
test.each([
	["sin verificar, confirmado", UNVERIFIED, UNVERIFIED, null],
	["verificación revocada", USER, UNVERIFIED, null],
	["verificada en otro dispositivo", UNVERIFIED, FIXED, FIXED.email],
])("%s", async (_name, snapshot, refreshed, directoryEmail) => {
	const session = fakeSession();
	const account = fakeAccount([{ id: "own", isOwner: true }]);
	const steps: string[] = [];
	// "listing" must come first: the UI uses it to block a second run.
	vi.mocked(session.refreshEmailVerification).mockImplementation(async () => {
		steps.push("refresh");
		return refreshed;
	});

	await deleteAccount(session, account, snapshot, (step) => {
		steps.push(step.phase);
	});

	const full = directoryEmail !== null;
	expect(account.deleteReceivedInvitations).toHaveBeenCalledWith("u1");
	if (full) expect(account.deleteSentInvitations).toHaveBeenCalledWith("u1");
	else expect(account.deleteSentInvitations).not.toHaveBeenCalled();
	expect(account.listMemberEvents).toHaveBeenCalledTimes(full ? 1 : 0);
	expect(account.deleteOwnEvent).toHaveBeenCalledTimes(full ? 1 : 0);
	expect(account.deleteAllEventImages).toHaveBeenCalledWith("u1");
	expect(account.deleteDirectoryEntries).toHaveBeenCalledWith(
		"u1",
		directoryEmail,
	);
	expect(session.deleteAccount).toHaveBeenCalledOnce();
	expect(steps).toEqual(
		full
			? [
					"listing",
					"refresh",
					"deleting-events",
					"deleting-directory",
					"deleting-account",
				]
			: ["listing", "refresh", "deleting-directory", "deleting-account"],
	);
});

test.each([
	"deleteAllEventImages",
	"deleteDirectoryEntries",
	"deleteReceivedInvitations",
] as const)("sin verificar, si falla %s no borra la cuenta", async (step) => {
	const session = fakeSession(UNVERIFIED);
	const account = fakeAccount([]);
	vi.mocked(account[step]).mockRejectedValue(new Error("x"));

	await expect(deleteAccount(session, account, UNVERIFIED)).rejects.toThrow(
		"x",
	);
	expect(session.deleteAccount).not.toHaveBeenCalled();
});

function expectNothingDeleted(account: AccountDataPort, session: SessionPort) {
	expect(account.listMemberEvents).not.toHaveBeenCalled();
	expect(account.deleteAllEventImages).not.toHaveBeenCalled();
	expect(account.deleteDirectoryEntries).not.toHaveBeenCalled();
	expect(account.deleteReceivedInvitations).not.toHaveBeenCalled();
	expect(account.deleteSentInvitations).not.toHaveBeenCalled();
	expect(session.deleteAccount).not.toHaveBeenCalled();
}

test.each([
	["sin sesión", USER, null],
	["otra cuenta, verificada", USER, { ...USER, uid: "u2" }],
	["otra cuenta, sin verificar", UNVERIFIED, { ...UNVERIFIED, uid: "u2" }],
])(
	"la lectura fresca no es esta cuenta (%s): no borra nada",
	async (_name, snapshot, refreshed) => {
		const session = fakeSession(refreshed);
		const account = fakeAccount([{ id: "own", isOwner: true }]);
		const steps: string[] = [];

		await expect(
			deleteAccount(session, account, snapshot, (step) => {
				steps.push(step.phase);
			}),
		).rejects.toMatchObject({ code: "unknown" });
		expectNothingDeleted(account, session);
		expect(steps).toEqual(["listing"]);
	},
);

test.each([USER, UNVERIFIED])(
	"si la lectura fresca falla, rechaza sin borrar nada (verificada: $emailVerified)",
	async (snapshot) => {
		const session = fakeSession();
		vi.mocked(session.refreshEmailVerification).mockRejectedValue(
			new Error("net"),
		);
		const account = fakeAccount([{ id: "own", isOwner: true }]);

		await expect(deleteAccount(session, account, snapshot)).rejects.toThrow(
			"net",
		);
		expectNothingDeleted(account, session);
	},
);

test("verificada, borra las invitaciones recibidas y enviadas antes de la cuenta", async () => {
	const order: string[] = [];
	const session = fakeSession();
	const account = fakeAccount([{ id: "own", isOwner: true }]);
	vi.mocked(account.deleteReceivedInvitations).mockImplementation(async () => {
		order.push("received");
	});
	vi.mocked(account.deleteSentInvitations).mockImplementation(async () => {
		order.push("sent");
	});
	vi.mocked(session.deleteAccount).mockImplementation(async () => {
		order.push("auth");
	});

	await deleteAccount(session, account, USER);

	expect(account.deleteReceivedInvitations).toHaveBeenCalledWith("u1");
	expect(account.deleteSentInvitations).toHaveBeenCalledWith("u1");
	expect(order).toEqual(["received", "sent", "auth"]);
});

test.each(["deleteReceivedInvitations", "deleteSentInvitations"] as const)(
	"verificada, si falla %s no borra la cuenta",
	async (step) => {
		const session = fakeSession();
		const account = fakeAccount([]);
		vi.mocked(account[step]).mockRejectedValue(new Error("inv"));

		await expect(deleteAccount(session, account, USER)).rejects.toThrow("inv");
		expect(session.deleteAccount).not.toHaveBeenCalled();
	},
);
