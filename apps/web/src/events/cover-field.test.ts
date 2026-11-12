import { expect, test, vi } from "vitest";
import type { ImageStorePort } from "../application/ports/image-store.js";
import type { SessionUser } from "../application/ports/session.js";
import { CoverField } from "./cover-field.js";

const URL_OK = "https://example.com/cover.png";

/** An upload held open until the test settles it. */
function heldStore() {
	let finish: (failure?: Error) => void = () => {};
	let report: (percent: number) => void = () => {};
	const upload = vi.fn(
		(_file: File, _folder: string, onProgress: (percent: number) => void) =>
			new Promise<string>((resolve, reject) => {
				report = onProgress;
				finish = (failure) => (failure ? reject(failure) : resolve(URL_OK));
			}),
	);
	const store = { upload } as unknown as ImageStorePort;
	const progress = (percent: number) => report(percent);
	return { store, upload, progress, settle: (f?: Error) => finish(f) };
}

function setup(store = heldStore()) {
	const host = { requestUpdate: vi.fn() };
	const state = { error: "previous" };
	const cover = new CoverField(host, {
		getImageStore: () => store.store,
		getUser: () => ({ uid: "abc" }) as SessionUser,
		setError: (message) => {
			state.error = message;
		},
	});
	return { host, state, cover, store };
}

/** What `@change` hands over: the input, with its chosen file. */
function choose(size: number) {
	const file = new File([new Uint8Array(size)], "a.png", { type: "image/png" });
	const input = { files: [file], value: "C:\\fakepath\\a.png" };
	return { input, event: { target: input } as unknown as Event };
}

const STORAGE_RULES_LIMIT = 5 * 1024 * 1024;

test("5 MB o más se rechaza antes de subir, con un aviso que se entiende", () => {
	const { cover, state, store } = setup();
	const { input, event } = choose(STORAGE_RULES_LIMIT);
	void cover.onFile(event);
	expect(store.upload).not.toHaveBeenCalled();
	expect(state.error).toBe("Images must be smaller than 5 MB.");
	expect(input.value).toBe("");
});

test("sube a la carpeta del usuario, enseña el progreso y deja la URL", async () => {
	const { host, cover, state, store } = setup();
	const repaints = () => host.requestUpdate.mock.calls.length;
	const { input, event } = choose(STORAGE_RULES_LIMIT - 1);
	const done = cover.onFile(event);
	expect(state.error).toBe("");
	expect(store.upload.mock.calls[0]?.[1]).toBe("events/abc");
	let before = repaints();
	store.progress(40);
	expect(cover.progress).toBe(40);
	expect(repaints()).toBeGreaterThan(before);
	before = repaints();
	store.settle();
	await done;
	expect(cover.imageUrl).toBe(URL_OK);
	expect(cover.uploading).toBe(false);
	expect(repaints()).toBeGreaterThan(before);
	expect(input.value).toBe("");
});

test("si la subida falla lo dice y suelta el campo", async () => {
	const { host, cover, state, store } = setup();
	const done = cover.onFile(choose(10).event);
	const before = host.requestUpdate.mock.calls.length;
	store.settle(new Error("boom"));
	await done;
	expect(state.error).toContain("could not be uploaded");
	expect(cover.uploading).toBe(false);
	expect(host.requestUpdate.mock.calls.length).toBeGreaterThan(before);
});

test("reset() parte de la imagen dada y quitarla la deja vacía", () => {
	const { cover, host } = setup();
	cover.progress = 70;
	cover.reset(URL_OK);
	expect(cover.imageUrl).toBe(URL_OK);
	expect(cover.progress).toBe(0);
	cover.remove();
	expect(cover.imageUrl).toBe("");
	expect(host.requestUpdate).toHaveBeenCalledTimes(2);
});
