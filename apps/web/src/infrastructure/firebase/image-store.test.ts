import { FirebaseError, initializeApp } from "firebase/app";
import { type FirebaseStorage, getStorage } from "firebase/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";

// `FirebaseImageStore` is a thin delegation to `uploadFile()` (see that
// function's own test for the upload mechanics: progress, resolve/reject,
// filename sanitization). This only checks the delegation itself — the
// right storage instance, file, prefix, and progress callback reach it.

const uploadFileMock = vi.fn();

vi.mock("../../firebase/storage.js", () => ({
	uploadFile: uploadFileMock,
}));

// For `createAccountDataAdapter`'s `deleteEventImage` below: only
// `deleteObject` replaced, so URL parsing (`ref`) is the real SDK's.
const deleteObjectMock = vi.hoisted(() => vi.fn());
vi.mock("firebase/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("firebase/storage")>()),
	deleteObject: deleteObjectMock,
}));
const { FirebaseImageStore } = await import("./image-store.js");
const { createAccountDataAdapter } = await import("./account-data-adapter.js");

describe("FirebaseImageStore", () => {
	beforeEach(() => {
		uploadFileMock.mockReset().mockResolvedValue("https://example.com/f.png");
	});

	test("upload() delega en uploadFile con el storage, el fichero, el prefijo y el progreso", async () => {
		const storage = { name: "fake-storage" } as unknown as FirebaseStorage;
		const store = new FirebaseImageStore(storage);
		const file = new File(["x"], "cover.png", { type: "image/png" });
		const onProgress = vi.fn();

		const url = await store.upload(file, "events/uid-1", onProgress);

		expect(uploadFileMock).toHaveBeenCalledWith(
			storage,
			file,
			"events/uid-1",
			onProgress,
		);
		expect(url).toBe("https://example.com/f.png");
	});

	test("upload() funciona sin callback de progreso", async () => {
		const store = new FirebaseImageStore({} as unknown as FirebaseStorage);
		const file = new File(["x"], "cover.png", { type: "image/png" });

		await store.upload(file, "events/uid-1");

		expect(uploadFileMock).toHaveBeenCalledWith(
			{},
			file,
			"events/uid-1",
			undefined,
		);
	});
});

// Belongs in `account-data-adapter.test.ts`, which doesn't exist yet: a new
// file under `infrastructure/firebase/` would exceed `TOPE_ACOPLADOS`. Move it
// there once that file lands (#100).
describe("deleteEventImage (account-data-adapter)", () => {
	// A real Storage instance, so `ref()` parses URLs as in production. No
	// request leaves: `deleteObject` is the mock.
	const BUCKET = "planu-test.appspot.com";
	const storage = getStorage(
		initializeApp({ projectId: "planu-test", storageBucket: BUCKET }, "adt"),
	);
	const adapter = createAccountDataAdapter({} as never, storage);
	const url = (bucket: string, path: string) =>
		`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
	const OWN = url(BUCKET, "events/u1/1731000000000_cartel.png");

	beforeEach(() => {
		deleteObjectMock.mockReset().mockResolvedValue(undefined);
	});

	test("borra una imagen bajo el prefijo propio", async () => {
		await adapter.deleteEventImage(OWN, "u1");

		expect(deleteObjectMock).toHaveBeenCalledOnce();
		expect(deleteObjectMock.mock.calls[0]?.[0]).toMatchObject({
			bucket: BUCKET,
			fullPath: "events/u1/1731000000000_cartel.png",
		});
	});

	test("borra una ruta propia de justo 1024 bytes", async () => {
		const path = `events/u1/${"a".repeat(1014)}`;

		await adapter.deleteEventImage(url(BUCKET, path), "u1");

		expect(deleteObjectMock.mock.calls[0]?.[0]).toMatchObject({
			fullPath: path,
		});
	});

	test("ignora una imagen propia que ya no existe", async () => {
		const gone = new FirebaseError("storage/object-not-found", "");
		deleteObjectMock.mockRejectedValueOnce(gone);

		await expect(adapter.deleteEventImage(OWN, "u1")).resolves.toBeUndefined();
	});

	test("relanza otro error bajo el prefijo propio en vez de dar la imagen por borrada", async () => {
		const denied = new FirebaseError("storage/unauthorized", "");
		deleteObjectMock.mockRejectedValueOnce(denied);

		await expect(adapter.deleteEventImage(OWN, "u1")).rejects.toBe(denied);
	});

	// An editor's cover on the owner's event lives under the editor's uid:
	// the owner can't delete it, and failing would block their deletion.
	test.each([
		["el prefijo de otro uid", url(BUCKET, "events/u2/a.png")],
		["un prefijo que sólo empieza igual", url(BUCKET, "events/u10/a.png")],
		["otro bucket", url("ajeno.appspot.com", "events/u1/a.png")],
		// `ref()` doesn't normalise, and the rules match exactly one segment.
		["un `..` que sale del prefijo", url(BUCKET, "events/u1/../u2/x.png")],
		["una subcarpeta", url(BUCKET, "events/u1/a/b.png")],
		["la carpeta sin nombre", url(BUCKET, "events/u1/")],
		["una barra doblemente codificada", url(BUCKET, "events/u1/a%2Fb.png")],
		["un nombre unicode", url(BUCKET, "events/u1/cartél.png")],
		["un nombre `..`", url(BUCKET, "events/u1/..")],
		["un nombre `.`", url(BUCKET, "events/u1/.")],
		// Production caps object names at 1024 bytes; the emulator doesn't.
		["una ruta de 1025 bytes", url(BUCKET, `events/u1/${"a".repeat(1015)}`)],
		["una URL que no es de Storage", "https://example.com/a.png"],
	])("salta sin error una imagen fuera del alcance: %s", async (_, foreign) => {
		await expect(
			adapter.deleteEventImage(foreign, "u1"),
		).resolves.toBeUndefined();
		expect(deleteObjectMock).not.toHaveBeenCalled();
	});
});
