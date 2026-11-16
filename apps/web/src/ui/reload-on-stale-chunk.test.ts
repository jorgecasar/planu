import { expect, test, vi } from "vitest";
import {
	RELOAD_FLAG,
	RELOAD_WINDOW_MS,
	reloadOnceOnStaleChunk,
} from "./reload-on-stale-chunk.js";

function deps(now: number, initial?: string) {
	const store = new Map<string, string>();
	if (initial) store.set(RELOAD_FLAG, initial);
	return {
		reload: vi.fn(),
		now: () => now,
		storage: {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
		},
	};
}

test("la primera vez que falla un chunk recarga la página", () => {
	const d = deps(1_000_000);
	expect(reloadOnceOnStaleChunk(d)).toBe(true);
	expect(d.reload).toHaveBeenCalledTimes(1);
});

test("si ya recargó hace un momento no vuelve a recargar", () => {
	const d = deps(1_000_000, String(1_000_000 - 1_000));
	expect(reloadOnceOnStaleChunk(d)).toBe(false);
	expect(d.reload).not.toHaveBeenCalled();
});

test("pasado el plazo vuelve a recargar", () => {
	const d = deps(1_000_000, String(1_000_000 - RELOAD_WINDOW_MS - 1));
	expect(reloadOnceOnStaleChunk(d)).toBe(true);
	expect(d.reload).toHaveBeenCalledTimes(1);
});

test("si el almacenamiento falla, recarga una vez igualmente", () => {
	const d = {
		reload: vi.fn(),
		now: () => 1,
		storage: {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		},
	};
	expect(reloadOnceOnStaleChunk(d)).toBe(true);
	expect(d.reload).toHaveBeenCalledTimes(1);
});
