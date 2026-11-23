import { expect, test } from "./fixtures.js";
import { atEachViewport, axeBuilder, expectNoViolations } from "./tests/axe.js";
import { signUpVerified } from "./verified-account.js";

// Main screens, scanned with the pinned WCAG 2.1 A/AA tags at a desktop and a
// phone viewport. Dialogs and reflow have their own specs.

test("login passes the pinned axe scan on desktop and mobile", async ({
	page,
}) => {
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();

	await atEachViewport(page, (name) =>
		expectNoViolations(page, `login ${name}`),
	);
});

test("events list, empty and with an event, passes on desktop and mobile", async ({
	page,
}) => {
	await signUpVerified(page);
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
	await atEachViewport(page, (name) =>
		expectNoViolations(page, `empty ${name}`),
	);

	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill("Summer concert");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(
		page.getByRole("heading", { name: "Summer concert" }),
	).toBeVisible();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	await atEachViewport(page, (name) =>
		expectNoViolations(page, `with event ${name}`),
	);
});

test("profile passes on desktop and mobile", async ({ page }) => {
	await signUpVerified(page);
	await page.goto("/app/profile");
	await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

	await atEachViewport(page, (name) =>
		expectNoViolations(page, `profile ${name}`),
	);
});

test("the shared scan reports a violation when there is one", async ({
	page,
}) => {
	// Without this, an unpinned or misconfigured helper would pass forever.
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();
	await page.evaluate(() => {
		const img = document.createElement("img");
		img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
		document.body.append(img);
	});

	const results = await axeBuilder(page).analyze();
	expect(results.violations.map((v) => v.id)).toContain("image-alt");
	for (const v of results.violations) {
		expect(v.tags.some((t) => /^wcag2(1)?a{1,2}$/.test(t))).toBe(true);
	}
});
