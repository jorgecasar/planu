import type { FirebaseStorage } from "firebase/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";

// `FirebaseImageStore` is a thin delegation to `uploadFile()` (see that
// function's own test for the upload mechanics: progress, resolve/reject,
// filename sanitization). This only checks the delegation itself — the
// right storage instance, file, prefix, and progress callback reach it.

const uploadFileMock = vi.fn();

vi.mock("../../firebase/storage.js", () => ({
	uploadFile: uploadFileMock,
}));

const { FirebaseImageStore } = await import("./image-store.js");

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
