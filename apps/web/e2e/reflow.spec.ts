import { expect, test } from "./fixtures.js";
import { cardAction } from "./tests/card-actions.js";
import { expectNoHorizontalScroll } from "./tests/reflow.js";
import { signUpVerified } from "./verified-account.js";

// WCAG 2.1 SC 1.4.10: no horizontal scrolling at 320 CSS px wide.

test("login does not scroll sideways at 320 px", async ({ page }) => {
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();
	await expectNoHorizontalScroll(page, "login");
});

test("events list, empty and with an event, does not scroll sideways at 320 px", async ({
	page,
}) => {
	await signUpVerified(page);
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
	await expectNoHorizontalScroll(page, "empty list");

	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill("Summer concert");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(
		page.getByRole("heading", { name: "Summer concert" }),
	).toBeVisible();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
	await expectNoHorizontalScroll(page, "list with an event");

	await cardAction(page, "Share");
	await expect(page.getByLabel("Invite by email")).toBeVisible();
	await expectNoHorizontalScroll(page, "share dialog");
});

test("profile does not scroll sideways at 320 px", async ({ page }) => {
	await signUpVerified(page);
	await page.goto("/app/profile");
	await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
	await expectNoHorizontalScroll(page, "profile");
});
