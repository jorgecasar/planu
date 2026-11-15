/**
 * Analytics consent (ADR 0017). Pure: storage and clock are injected, no
 * Firebase and no DOM. The decision is kept with its date and expires after
 * 12 months, when the user is asked again.
 */

export type ConsentState = "granted" | "denied" | "unset";
export type ConsentDecision = Exclude<ConsentState, "unset">;

export const CONSENT_KEY = "planu-analytics-consent";
export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface ConsentStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface ConsentStore {
	get(): ConsentState;
	set(decision: ConsentDecision): void;
	clear(): void;
	subscribe(listener: (state: ConsentState) => void): () => void;
}

function parse(raw: string | null, now: number): ConsentState {
	if (raw === null) return "unset";
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return "unset";
		const { decision, at } = value as Record<string, unknown>;
		if (decision !== "granted" && decision !== "denied") return "unset";
		if (typeof at !== "number" || !Number.isFinite(at)) return "unset";
		// A date in the future means the clock moved back: it cannot be trusted.
		if (at > now || now - at >= CONSENT_TTL_MS) return "unset";
		return decision;
	} catch {
		return "unset";
	}
}

/**
 * `storage` may be `undefined` (no localStorage) or throw (private mode,
 * quota): the decision then lives only in memory for this page.
 */
export function createConsentStore(
	storage: ConsentStorage | undefined,
	now: () => number = Date.now,
): ConsentStore {
	const listeners = new Set<(state: ConsentState) => void>();
	let memory: { decision: ConsentDecision; at: number } | undefined;
	// Set when the last write did not reach storage: whatever storage still
	// holds is then stale, so the in-memory decision (or its absence) wins.
	// Without it, a failed write could leave a persisted grant in force after
	// the user withdrew consent.
	let unpersisted = false;

	const fromMemory = (): ConsentState =>
		memory ? parse(JSON.stringify(memory), now()) : "unset";

	const notify = () => {
		const state = store.get();
		for (const listener of listeners) listener(state);
	};

	const store: ConsentStore = {
		get() {
			if (unpersisted) return fromMemory();
			try {
				if (storage) return parse(storage.getItem(CONSENT_KEY), now());
			} catch {
				// Unreadable storage: fall back to the in-memory decision.
			}
			return fromMemory();
		},
		set(decision) {
			memory = { decision, at: now() };
			try {
				storage?.setItem(CONSENT_KEY, JSON.stringify(memory));
				unpersisted = false;
			} catch {
				// Not persisted; the in-memory copy overrides what storage holds.
				unpersisted = true;
			}
			notify();
		},
		clear() {
			memory = undefined;
			try {
				storage?.removeItem(CONSENT_KEY);
				unpersisted = false;
			} catch {
				// Not removed; the absence of a decision overrides what storage holds.
				unpersisted = true;
			}
			notify();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
	return store;
}

let shared: ConsentStore | undefined;

/** The app-wide store, backed by `localStorage`. Created on first use. */
export function appConsent(): ConsentStore {
	if (!shared) {
		let storage: ConsentStorage | undefined;
		try {
			// Merely reading `localStorage` can throw when storage is blocked.
			storage = localStorage;
		} catch {
			storage = undefined;
		}
		shared = createConsentStore(storage);
	}
	return shared;
}
