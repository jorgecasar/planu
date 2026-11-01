import { expect, type Page } from "@playwright/test";

const AUTH_EMULATOR = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const API_KEY = "demo-api-key";

/** Unique email per run: the emulator keeps accounts between runs. */
export const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/**
 * Creates an account with its email already verified, via the emulator.
 *
 * ADR 0011 (docs/adr/0011-verificacion-de-email-obligatoria.md) makes a
 * verified email mandatory to use events. Signing up through the UI form
 * alone — the pattern every e2e spec used before — leaves `email_verified`
 * false: the guard (T61) sends that account to the profile, and with T60
 * `firestore.rules` also denies it every event operation. Extracted here
 * from `e2e/sharing.spec.ts` and `e2e/account-deletion.spec.ts`, which each
 * kept a private copy for the user directory's sake, once more specs needed
 * the exact same flow just to keep exercising events at all.
 *
 * It has to go through the real verification code, not a shortcut: the
 * emulator **ignores `emailVerified` on `accounts:update`** and returns an
 * unverified account without raising any error.
 */
export async function createVerifiedAccount(
	page: Page,
	email: string,
	password = "secret123",
): Promise<void> {
	const signUp = await page.request.post(
		`${AUTH_EMULATOR}/accounts:signUp?key=${API_KEY}`,
		{ data: { email, password, returnSecureToken: true } },
	);
	expect(signUp.ok()).toBe(true);
	const { idToken } = (await signUp.json()) as { idToken: string };

	await page.request.post(
		`${AUTH_EMULATOR}/accounts:sendOobCode?key=${API_KEY}`,
		{ data: { requestType: "VERIFY_EMAIL", idToken } },
	);

	// The emulator stores the mail it would send instead of sending it.
	const inbox = await page.request.get(
		"http://127.0.0.1:9099/emulator/v1/projects/planu-app/oobCodes",
	);
	const { oobCodes } = (await inbox.json()) as {
		oobCodes: { email: string; oobCode: string; requestType: string }[];
	};
	const code = oobCodes
		.filter(
			(entry) => entry.email === email && entry.requestType === "VERIFY_EMAIL",
		)
		.at(-1);
	expect(code, `no verification code for ${email}`).toBeDefined();

	const applied = await page.request.post(
		`${AUTH_EMULATOR}/accounts:update?key=${API_KEY}`,
		{ data: { oobCode: code?.oobCode } },
	);
	expect(applied.ok()).toBe(true);
	expect((await applied.json()).emailVerified).toBe(true);
}

/** Signs in with an existing account through the real login form. */
export async function signIn(
	page: Page,
	email: string,
	password = "secret123",
): Promise<void> {
	await page.goto("/app/login");
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Password" })
		.first();
	await panel.getByLabel("Email").fill(email);
	await panel.getByLabel("Password", { exact: true }).fill(password);
	await panel.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
}

/** Creates a verified account and signs into it — the common case for specs
 * that only need an authenticated session able to use events, not the
 * sign-up form itself (that is `e2e/auth.spec.ts`'s job). */
export async function signUpVerified(page: Page): Promise<void> {
	const email = newEmail();
	await createVerifiedAccount(page, email);
	await signIn(page, email);
}
