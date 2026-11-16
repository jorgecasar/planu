/**
 * After a deploy, a tab that was already open still points to the lazy
 * chunks of the previous build, which Hosting no longer serves. The route's
 * dynamic import then fails and the click on Profile does nothing until the
 * person refreshes. Reloading once on that route loads the new build.
 *
 * It reloads at most once per window: if the chunk is missing for another
 * reason (offline, a real outage), reloading in a loop would be worse than
 * the original failure.
 */
export const RELOAD_FLAG = "planu:stale-chunk-reload";
export const RELOAD_WINDOW_MS = 10_000;

export interface ReloadDeps {
	reload: () => void;
	now: () => number;
	storage: Pick<Storage, "getItem" | "setItem">;
}

const defaultDeps = (): ReloadDeps => ({
	reload: () => window.location.reload(),
	now: () => Date.now(),
	storage: window.sessionStorage,
});

/** Returns true if it asked for a reload, false if it already did a moment ago. */
export function reloadOnceOnStaleChunk(
	deps: ReloadDeps = defaultDeps(),
): boolean {
	try {
		const last = Number(deps.storage.getItem(RELOAD_FLAG));
		if (last && deps.now() - last < RELOAD_WINDOW_MS) return false;
		deps.storage.setItem(RELOAD_FLAG, String(deps.now()));
	} catch {
		// Storage can be blocked: reload once rather than never.
	}
	deps.reload();
	return true;
}
