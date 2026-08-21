/**
 * Errors that occur before the Sentry SDK is loaded.
 *
 * Observability is loaded lazily, after the first paint, because loading it
 * earlier costs LCP. The price is a blind window of a couple of seconds —
 * and it's exactly the window where a broken deploy shows up: a chunk that
 * doesn't download, Firebase that fails to initialize, `initLocale()`
 * throwing. Those errors used to be invisible.
 *
 * This saves them from the very first line of `main.ts` and replays them
 * once the SDK finishes loading. Sentry recommends initializing "as early
 * as possible"; this is how that intent is honored without paying the
 * startup cost.
 */

/** Deliberately low cap: a failure in a loop shouldn't eat up memory. */
const MAX = 10;

const buffered: unknown[] = [];
let listening = false;

function record(reason: unknown): void {
	if (buffered.length < MAX) buffered.push(reason);
}

function onError(event: ErrorEvent): void {
	record(event.error ?? new Error(event.message));
}

function onRejection(event: PromiseRejectionEvent): void {
	record(event.reason);
}

/**
 * Starts listening. Must be called before anything else, and it's
 * synchronous and dependency-free on purpose: if this needed to load
 * something, the blind window it comes to close would exist again.
 */
export function captureStartupErrors(): void {
	if (listening) return;
	listening = true;
	globalThis.addEventListener("error", onError);
	globalThis.addEventListener("unhandledrejection", onRejection);
}

/**
 * Replays what accumulated and steps aside.
 *
 * Its own handlers are removed: from here on the SDK listens, and leaving
 * them in place would duplicate every error.
 */
export function flushStartupErrors(sentry: {
	captureException: (e: unknown) => unknown;
}): void {
	globalThis.removeEventListener("error", onError);
	globalThis.removeEventListener("unhandledrejection", onRejection);
	listening = false;

	while (buffered.length > 0) {
		const reason = buffered.shift();
		try {
			sentry.captureException(reason);
		} catch {
			// If the replay itself fails there's nowhere to report it, and it
			// certainly shouldn't bring down the application.
		}
	}
}

/** Only for tests: empties the module's state between cases. */
export function resetStartupBuffer(): void {
	globalThis.removeEventListener("error", onError);
	globalThis.removeEventListener("unhandledrejection", onRejection);
	listening = false;
	buffered.length = 0;
}
