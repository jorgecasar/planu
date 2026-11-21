import { test as base, expect } from "@playwright/test";

const PROJECT = "planu-app";
const AUTH_RESET = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`;
const FIRESTORE_RESET = `http://127.0.0.1:8181/emulator/v1/projects/${PROJECT}/databases/planu/documents`;

/**
 * Every test starts with no accounts and no documents: Auth and Firestore are
 * wiped. Storage is not; its objects live under unique uids, so they cannot
 * collide.
 *
 * Unique emails and titles already kept tests from colliding by name, but
 * they still shared one emulator, so whatever an earlier test left behind
 * (a half-finished deletion, a pending offer) was part of the state of the
 * next one. Wiping is only safe because `playwright.config.ts` runs a single
 * worker: with two, one worker would erase the data of the other mid-test.
 *
 * It fails loudly when an emulator is not there: a suite that cannot reset
 * its state is not deterministic, and saying so beats running it anyway.
 */
export const test = base.extend<{ emulatorsReset: undefined }>({
	emulatorsReset: [
		async ({ request }, use) => {
			for (const url of [AUTH_RESET, FIRESTORE_RESET]) {
				const response = await request.delete(url);
				expect(response.ok(), `resetting ${url}`).toBe(true);
			}
			await use(undefined);
		},
		{ auto: true },
	],
});

export { expect };
