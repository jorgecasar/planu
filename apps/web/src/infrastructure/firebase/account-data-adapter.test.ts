import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { emailHash } from "../../sharing/user-directory.js";

// Same pattern as `sharing-adapter.test.ts`: the SDK is mocked, so each call
// is checked by the path and constraints it receives, without an emulator.
// A query is reduced to a "path|field op value" key that `getDocs` answers.
type Snapshot = { id: string; ref: { path: string }; data: () => object };
const answers = new Map<string, Snapshot[]>();
const snap = (path: string, data: object = {}): Snapshot => ({
	id: path.split("/").pop() as string,
	ref: { path },
	data: () => data,
});

const getDocs = vi.fn(async (key: string) => ({
	docs: answers.get(key) ?? [],
}));
const deleteDoc = vi.fn(async (_ref: { path: string }) => {});
const updateDoc = vi.fn(async (_ref: { path: string }, _data: object) => {});
const listAll = vi.fn();
const deleteObject = vi.fn();

vi.mock("firebase/firestore", () => ({
	collection: (_db: unknown, path: string) => path,
	where: (field: string, op: string, value: string) =>
		`${field} ${op} ${value}`,
	query: (path: string, constraint: string) => `${path}|${constraint}`,
	doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
	getDocs,
	deleteDoc,
	updateDoc,
}));
vi.mock("firebase/storage", () => ({
	ref: (_storage: unknown, path: string) => ({ fullPath: path }),
	listAll,
	deleteObject,
}));

const { createAccountDataAdapter } = await import("./account-data-adapter.js");
const adapter = createAccountDataAdapter(
	{} as Firestore,
	{} as FirebaseStorage,
);

const MEMBER_OF = "events|memberIds array-contains ana";

beforeEach(() => {
	answers.clear();
	vi.clearAllMocks();
	listAll.mockReset();
	deleteObject.mockReset();
});

describe("eventos de la cuenta", () => {
	test("lista por memberIds y sólo da la imagen de los eventos propios", async () => {
		answers.set(MEMBER_OF, [
			snap("events/e1", { userId: "ana", imageUrl: "https://img/1" }),
			snap("events/e2", { userId: "luis", imageUrl: "https://img/2" }),
			snap("events/e3", { userId: "ana", imageUrl: "" }),
		]);

		expect(await adapter.listMemberEvents("ana")).toEqual([
			{ id: "e1", isOwner: true, imageUrl: "https://img/1" },
			{ id: "e2", isOwner: false },
			{ id: "e3", isOwner: true },
		]);
	});

	test("borra el documento del evento propio", async () => {
		await adapter.deleteOwnEvent("e1");
		expect(deleteDoc).toHaveBeenCalledWith({ path: "events/e1" });
	});

	test("al salir de un evento ajeno quita su uid de memberIds y de roles", async () => {
		answers.set(MEMBER_OF, [
			snap("events/e2", {
				memberIds: ["luis", "ana"],
				roles: { luis: "owner", ana: "viewer" },
			}),
		]);

		await adapter.leaveEvent("e2", "ana");

		expect(updateDoc).toHaveBeenCalledWith(
			{ path: "events/e2" },
			{ memberIds: ["luis"], roles: { luis: "owner" } },
		);
	});

	test("salir de un evento del que ya no es miembro no escribe nada", async () => {
		await adapter.leaveEvent("e2", "ana");
		expect(updateDoc).not.toHaveBeenCalled();
	});
});

// deleteEventImage (which images it may delete, and which errors it ignores)
// is covered by image-store.test.ts since #154.
describe("imágenes de la cuenta", () => {
	test("borra todo lo que hay bajo events/{uid}", async () => {
		const items = [
			{ fullPath: "events/ana/a.png" },
			{ fullPath: "events/ana/b.png" },
		];
		listAll.mockResolvedValue({ items });

		await adapter.deleteAllEventImages("ana");

		expect(listAll).toHaveBeenCalledWith({ fullPath: "events/ana" });
		expect(deleteObject.mock.calls).toEqual([[items[0]], [items[1]]]);
	});

	test("si no se puede listar la carpeta, el error llega al caso de uso", async () => {
		listAll.mockRejectedValue(new Error("storage/unauthorized"));
		await expect(adapter.deleteAllEventImages("ana")).rejects.toThrow(
			"storage/unauthorized",
		);
	});
});

describe("directorio e invitaciones", () => {
	test("borra el perfil y la entrada del directorio de su email", async () => {
		await adapter.deleteDirectoryEntries("ana", "ana@example.com");

		expect(deleteDoc.mock.calls).toEqual([
			[{ path: "userProfiles/ana" }],
			[{ path: `userDirectory/${await emailHash("ana@example.com")}` }],
		]);
	});

	test("sin email sólo borra el perfil", async () => {
		await adapter.deleteDirectoryEntries("ana", null);
		expect(deleteDoc.mock.calls).toEqual([[{ path: "userProfiles/ana" }]]);
	});

	test("borra las invitaciones recibidas, consultando por inviteeUid", async () => {
		answers.set("eventInvites|inviteeUid == ana", [snap("eventInvites/i1")]);

		await adapter.deleteReceivedInvitations("ana");

		expect(deleteDoc.mock.calls).toEqual([[{ path: "eventInvites/i1" }]]);
	});

	test("borra las invitaciones y las ofertas por email que envió", async () => {
		answers.set("eventInvites|invitedBy == ana", [snap("eventInvites/i2")]);
		answers.set("eventInvitesByEmail|invitedBy == ana", [
			snap("eventInvitesByEmail/o1"),
		]);

		await adapter.deleteSentInvitations("ana");

		expect(deleteDoc.mock.calls).toEqual([
			[{ path: "eventInvites/i2" }],
			[{ path: "eventInvitesByEmail/o1" }],
		]);
	});

	test("repetir el borrado sin nada pendiente no borra ni falla", async () => {
		await adapter.deleteReceivedInvitations("ana");
		await adapter.deleteSentInvitations("ana");
		expect(deleteDoc).not.toHaveBeenCalled();
	});

	test("un borrado de invitación rechazado no se traga", async () => {
		answers.set("eventInvites|invitedBy == ana", [snap("eventInvites/i2")]);
		deleteDoc.mockRejectedValueOnce(new Error("permission-denied"));
		await expect(adapter.deleteSentInvitations("ana")).rejects.toThrow(
			"permission-denied",
		);
	});
});
