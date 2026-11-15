import { FirebaseError, initializeApp } from "firebase/app";
import { type FirebaseStorage, getStorage } from "firebase/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mocks the Storage SDK so the upload wiring (progress, resolve/reject) and
// the filename sanitization can be tested without an emulator. `ref` keeps
// the real SDK's behaviour by default, because `deleteEventImage` below
// parses real URLs with it; the upload tests swap it for a recorder.
const sdk = vi.hoisted(() => ({
	realRef: undefined as unknown as typeof import("firebase/storage").ref,
	deleteObject: vi.fn(),
	getDownloadURL: vi.fn(),
	ref: vi.fn(),
	uploadBytesResumable: vi.fn(),
}));
const deleteObjectMock = sdk.deleteObject;
const getDownloadURLMock = sdk.getDownloadURL;
const refMock = sdk.ref;
const uploadBytesResumableMock = sdk.uploadBytesResumable;

vi.mock("firebase/storage", async (importOriginal) => {
	const original = await importOriginal<typeof import("firebase/storage")>();
	sdk.realRef = original.ref;
	sdk.ref.mockImplementation(original.ref);
	return {
		...original,
		deleteObject: sdk.deleteObject,
		getDownloadURL: sdk.getDownloadURL,
		ref: sdk.ref,
		uploadBytesResumable: sdk.uploadBytesResumable,
	};
});
const { FirebaseImageStore } = await import("./image-store.js");
const { createAccountDataAdapter } = await import("./account-data-adapter.js");

interface FakeTask {
	on: (
		event: "state_changed",
		progress: (snapshot: {
			bytesTransferred: number;
			totalBytes: number;
		}) => void,
		error: (err: unknown) => void,
		complete: () => void,
	) => void;
	snapshot: { ref: unknown };
	_fail: (err: unknown) => void;
	_succeed: () => void;
}

function fakeTask(taskRef: unknown): FakeTask {
	let onError: (err: unknown) => void = () => {};
	let onComplete: () => void = () => {};
	return {
		snapshot: { ref: taskRef },
		on: (_event, _progress, error, complete) => {
			onError = error;
			onComplete = complete;
		},
		_fail: (err) => onError(err),
		_succeed: () => onComplete(),
	};
}

describe("FirebaseImageStore", () => {
	const storage = {} as FirebaseStorage;

	beforeEach(() => {
		refMock.mockReset().mockImplementation((_s: unknown, path: string) => ({
			path,
		}));
		getDownloadURLMock.mockReset().mockResolvedValue("https://example.com/f");
		uploadBytesResumableMock.mockReset();
	});

	test("el nombre de fichero se sanea: los caracteres fuera de [a-zA-Z0-9._-] se sustituyen", async () => {
		// file.name is user-controlled. A `/` in it would add path segments
		// instead of escaping the Storage rules' fixed `events/{uid}/{fileName}`
		// shape — the SDK doesn't resolve `..`.
		const task = fakeTask({});
		uploadBytesResumableMock.mockReturnValue(task);
		const file = new File(["x"], "../secret/résumé caché.png");

		const promise = new FirebaseImageStore(storage).upload(
			file,
			"events/uid-1",
		);
		task._succeed();
		await promise;

		const [, path] = refMock.mock.calls[0] as [unknown, string];
		expect(path).not.toContain("/../");
		expect(path).not.toContain(" ");
		expect(path).toMatch(/^events\/uid-1\/\d+_.*\.png$/);
	});

	test("resuelve con la URL de descarga cuando la subida termina", async () => {
		const task = fakeTask({ marker: "the-ref" });
		uploadBytesResumableMock.mockReturnValue(task);
		getDownloadURLMock.mockResolvedValue("https://example.com/cover.png");

		const promise = new FirebaseImageStore(storage).upload(
			new File(["x"], "cover.png"),
			"events/uid-1",
		);
		task._succeed();

		await expect(promise).resolves.toBe("https://example.com/cover.png");
		expect(getDownloadURLMock).toHaveBeenCalledWith({ marker: "the-ref" });
	});

	test("rechaza si la subida falla, sin llegar a pedir la URL", async () => {
		const task = fakeTask({});
		uploadBytesResumableMock.mockReturnValue(task);
		const failure = new Error("network down");

		const promise = new FirebaseImageStore(storage).upload(
			new File(["x"], "cover.png"),
			"events/uid-1",
		);
		task._fail(failure);

		await expect(promise).rejects.toBe(failure);
		expect(getDownloadURLMock).not.toHaveBeenCalled();
	});

	test("informa del progreso como porcentaje de bytesTransferred/totalBytes", () => {
		let progressCb: (snapshot: {
			bytesTransferred: number;
			totalBytes: number;
		}) => void = () => {};
		uploadBytesResumableMock.mockReturnValue({
			snapshot: { ref: {} },
			on: (_event: string, progress: typeof progressCb) => {
				progressCb = progress;
			},
		});
		const onProgress = vi.fn();

		void new FirebaseImageStore(storage).upload(
			new File(["x"], "cover.png"),
			"events/uid-1",
			onProgress,
		);
		progressCb({ bytesTransferred: 25, totalBytes: 100 });

		expect(onProgress).toHaveBeenCalledWith(25);
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
		refMock.mockReset().mockImplementation(sdk.realRef);
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
