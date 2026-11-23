import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { cardAction } from "./tests/card-actions.js";
import { createVerifiedAccount, newEmail, signIn } from "./verified-account.js";

/**
 * Keyboard contract of the app dialogs (WCAG 2.1.2, 2.4.3): focus moves in,
 * Tab never leaves, Escape closes, and focus goes back to the opener.
 */

/** Tag chain, from the focused element up through every shadow root. */
async function focusPath(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		let el: Element | null = document.activeElement;
		while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
		const path: string[] = [];
		let node: Node | null = el;
		while (node) {
			if (node instanceof Element) path.push(node.localName);
			node =
				node.parentNode instanceof ShadowRoot
					? node.parentNode.host
					: node.parentNode;
		}
		return path;
	});
}

/**
 * Tab through more stops than the dialog has. Web Awesome opens a native
 * modal `<dialog>`, which makes the page behind inert: leaving the last
 * control hands focus to the browser chrome (`body` in headless Chromium)
 * and then back into the dialog, never to the page. So each stop is either
 * inside the dialog or on the bare document, and never on page content.
 */
async function expectTabStaysIn(page: Page, host: string): Promise<void> {
	for (let i = 0; i < 28; i++) {
		await page.keyboard.press(i < 14 ? "Tab" : "Shift+Tab");
		const path = await focusPath(page);
		const onBareDocument = path.join() === "body,html";
		expect(onBareDocument || path.includes(host), path.join(">")).toBe(true);
	}
}

test("the share dialog traps Tab, closes on Escape and returns focus to the card menu", async ({
	page,
}) => {
	const email = newEmail();
	await createVerifiedAccount(page, email);
	await signIn(page, email);
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill("Focus probe");
	await page.getByLabel("Description").fill("About focus");
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
	await cardAction(page, "Share");
	await expect(page.getByLabel("Invite by email")).toBeVisible();
	await expect.poll(() => focusPath(page)).toContain("planu-share-dialog");
	await expectTabStaysIn(page, "planu-share-dialog");
	await page.keyboard.press("Escape");
	await expect(page.getByLabel("Invite by email")).toBeHidden();
	await expect.poll(() => focusPath(page)).toContain("planu-event-card");
});

test("the delete-account dialog traps Tab, closes on Escape and returns focus to its button", async ({
	page,
}) => {
	const email = newEmail();
	await createVerifiedAccount(page, email);
	await signIn(page, email);
	await page.goto("/app/profile");
	const opener = page.getByRole("button", { name: "Delete account" });
	await opener.click();
	const confirm = page.getByLabel("Email");
	await expect(confirm).toBeVisible();
	await expect.poll(() => focusPath(page)).toContain("wa-dialog");
	await expectTabStaysIn(page, "wa-dialog");
	await page.keyboard.press("Escape");
	await expect(confirm).toBeHidden();
	await expect(opener).toBeFocused();
});

test("Escape does not interrupt a deletion in progress", async ({ page }) => {
	const email = newEmail();
	await createVerifiedAccount(page, email);
	await signIn(page, email);
	await page.goto("/app/profile");
	await page.getByRole("button", { name: "Delete account" }).click();
	await page.getByLabel("Email").fill(email);
	// Hold every Firestore call so the deletion stays in its first step.
	let release = (): void => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/:8181\//, async (route) => {
		await gate;
		await route.continue();
	});
	const dialog = page.locator("wa-dialog");
	await dialog.getByRole("button", { name: "Delete account" }).click();
	await expect(dialog.getByRole("button", { name: "Deleting…" })).toBeVisible();
	await page.keyboard.press("Escape");
	// `open` reflects to the attribute, and the close animation is short: wait
	// past it before asserting the dialog is still there.
	await page.waitForTimeout(500);
	await expect(dialog).toHaveAttribute("open", "");
	await expect(dialog.getByRole("button", { name: "Deleting…" })).toBeVisible();
	release();
	await expect(page).toHaveURL(/\/app\/login$/, { timeout: 15_000 });
});
