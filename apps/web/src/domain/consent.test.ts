import { describe, expect, test, vi } from "vitest";
import {
	CONSENT_KEY,
	CONSENT_TTL_MS,
	type ConsentStorage,
	createConsentStore,
} from "./consent.js";

function fakeStorage(initial?: string): ConsentStorage & {
	data: Map<string, string>;
} {
	const data = new Map<string, string>();
	if (initial !== undefined) data.set(CONSENT_KEY, initial);
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
	};
}

const T0 = 1_700_000_000_000;

describe("consent", () => {
	test("empty storage is unset", () => {
		expect(createConsentStore(fakeStorage(), () => T0).get()).toBe("unset");
	});

	test("a stored decision is read back", () => {
		const storage = fakeStorage();
		createConsentStore(storage, () => T0).set("granted");
		expect(createConsentStore(storage, () => T0 + 1000).get()).toBe("granted");
		createConsentStore(storage, () => T0).set("denied");
		expect(createConsentStore(storage, () => T0 + 1000).get()).toBe("denied");
	});

	test("expires exactly at 12 months, not one millisecond before", () => {
		const storage = fakeStorage();
		createConsentStore(storage, () => T0).set("granted");
		expect(CONSENT_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
		expect(
			createConsentStore(storage, () => T0 + CONSENT_TTL_MS - 1).get(),
		).toBe("granted");
		expect(createConsentStore(storage, () => T0 + CONSENT_TTL_MS).get()).toBe(
			"unset",
		);
	});

	test("a denial also expires", () => {
		const storage = fakeStorage();
		createConsentStore(storage, () => T0).set("denied");
		expect(createConsentStore(storage, () => T0 + CONSENT_TTL_MS).get()).toBe(
			"unset",
		);
	});

	test("a decision dated in the future (clock moved back) is unset", () => {
		const storage = fakeStorage();
		createConsentStore(storage, () => T0).set("granted");
		expect(createConsentStore(storage, () => T0 - 1).get()).toBe("unset");
	});

	test.each([
		"not json",
		"null",
		"42",
		'{"decision":"granted"}',
		'{"at":1}',
		'{"decision":"maybe","at":1}',
		'{"decision":"granted","at":"yesterday"}',
		'{"decision":"granted","at":null}',
		'{"decision":"granted","at":1e999}',
	])("corrupted storage %s is unset", (raw) => {
		expect(createConsentStore(fakeStorage(raw), () => T0).get()).toBe("unset");
	});

	test("storage that throws reads as unset and writes do not throw", () => {
		const broken: ConsentStorage = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => {
				throw new Error("denied");
			},
		};
		const store = createConsentStore(broken, () => T0);
		expect(store.get()).toBe("unset");
		expect(() => store.set("granted")).not.toThrow();
		expect(store.get()).toBe("granted");
	});

	/** Readable storage that holds a grant but refuses every write. */
	function readOnlyWithGrant(): ConsentStorage {
		const grant = JSON.stringify({ decision: "granted", at: T0 });
		return {
			getItem: () => grant,
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => {
				throw new Error("denied");
			},
		};
	}

	test("withdrawing consent works when the write fails over a persisted grant", () => {
		const store = createConsentStore(readOnlyWithGrant(), () => T0 + 1000);
		const listener = vi.fn();
		store.subscribe(listener);

		store.set("denied");

		expect(store.get()).toBe("denied");
		expect(listener).toHaveBeenCalledWith("denied");
		expect(listener).not.toHaveBeenCalledWith("granted");
	});

	test("clear overrides a persisted grant when the removal fails", () => {
		const store = createConsentStore(readOnlyWithGrant(), () => T0 + 1000);
		const listener = vi.fn();
		store.subscribe(listener);

		store.clear();

		expect(store.get()).toBe("unset");
		expect(listener).toHaveBeenCalledWith("unset");
		expect(listener).not.toHaveBeenCalledWith("granted");
	});

	test("once a write succeeds again, storage is the source of truth", () => {
		const data = new Map<string, string>();
		let failWrites = true;
		const storage: ConsentStorage = {
			getItem: (k) => data.get(k) ?? null,
			setItem: (k, v) => {
				if (failWrites) throw new Error("quota");
				data.set(k, v);
			},
			removeItem: (k) => void data.delete(k),
		};
		const store = createConsentStore(storage, () => T0);

		store.set("denied");
		expect(store.get()).toBe("denied");
		failWrites = false;
		store.set("granted");

		expect(store.get()).toBe("granted");
		expect(createConsentStore(storage, () => T0).get()).toBe("granted");
	});

	test("no storage at all keeps the decision in memory", () => {
		const store = createConsentStore(undefined, () => T0);
		store.set("denied");
		expect(store.get()).toBe("denied");
	});

	test("subscribers hear every change, and unsubscribing stops them", () => {
		const store = createConsentStore(fakeStorage(), () => T0);
		const listener = vi.fn();
		const off = store.subscribe(listener);
		store.set("granted");
		store.set("denied");
		off();
		store.set("granted");
		expect(listener.mock.calls).toEqual([["granted"], ["denied"]]);
	});

	test("clear goes back to unset and notifies", () => {
		const store = createConsentStore(fakeStorage(), () => T0);
		store.set("granted");
		const listener = vi.fn();
		store.subscribe(listener);
		store.clear();
		expect(store.get()).toBe("unset");
		expect(listener).toHaveBeenCalledWith("unset");
	});
});
