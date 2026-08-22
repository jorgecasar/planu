import type { FirebaseStorage } from "firebase/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mocks the Storage SDK so the upload wiring (progress, resolve/reject) and
// the filename sanitization can be tested without an emulator.

const refMock = vi.fn((_storage: unknown, path: string) => ({ path }));
const getDownloadURLMock = vi.fn();

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

function fakeTask(ref: unknown): FakeTask {
	let onError: (err: unknown) => void = () => {};
	let onComplete: () => void = () => {};
	return {
		snapshot: { ref },
		on: (_event, _progress, error, complete) => {
			onError = error;
			onComplete = complete;
		},
		_fail: (err) => onError(err),
		_succeed: () => onComplete(),
	};
}

const uploadBytesResumableMock = vi.fn();

vi.mock("firebase/storage", () => ({
	getDownloadURL: getDownloadURLMock,
	ref: refMock,
	uploadBytesResumable: uploadBytesResumableMock,
}));

const { uploadFile } = await import("./storage.js");

describe("uploadFile", () => {
	beforeEach(() => {
		refMock.mockClear();
		getDownloadURLMock.mockReset().mockResolvedValue("https://example.com/f");
		uploadBytesResumableMock.mockReset();
	});

	test("el nombre de fichero se sanea: los caracteres fuera de [a-zA-Z0-9._-] se sustituyen", async () => {
		// file.name is user-controlled. A `/` in it would add path segments
		// instead of escaping the Storage rules' fixed `events/{uid}/{fileName}`
		// shape — the SDK doesn't resolve `..` (see this function's own JSDoc).
		const task = fakeTask({});
		uploadBytesResumableMock.mockReturnValue(task);
		const file = new File(["x"], "../secret/résumé caché.png");

		const promise = uploadFile({} as FirebaseStorage, file, "events/uid-1");
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

		const promise = uploadFile(
			{} as FirebaseStorage,
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

		const promise = uploadFile(
			{} as FirebaseStorage,
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

		void uploadFile(
			{} as FirebaseStorage,
			new File(["x"], "cover.png"),
			"events/uid-1",
			onProgress,
		);
		progressCb({ bytesTransferred: 25, totalBytes: 100 });

		expect(onProgress).toHaveBeenCalledWith(25);
	});
});
