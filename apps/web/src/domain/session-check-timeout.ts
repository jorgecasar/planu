/**
 * Bounds how long the app waits for the initial session check.
 *
 * `onAuthStateChanged` (Firebase Auth) is expected to fire within a few
 * hundred milliseconds. Measured against real production traffic, it
 * sometimes never fires at all — no error, no rejected promise, just a
 * silent hang inside the SDK's persistence resolution (see
 * docs/spec-ci-e2e-reliability.md for the investigation; it does not
 * reproduce against the Auth emulator, so it is a production-only concern,
 * not a CI one). Without a bound, `app-shell.ts` shows the "checking your
 * session" spinner forever, with no way out for whoever hits it.
 */
export function watchSessionCheckTimeout(
	timeoutMs: number,
	onTimeout: () => void,
): () => void {
	const id = setTimeout(onTimeout, timeoutMs);
	return () => clearTimeout(id);
}
