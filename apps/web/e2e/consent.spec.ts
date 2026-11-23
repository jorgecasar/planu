import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures.js";

const CONSENT_ENTRY = "planu-analytics-consent";

test("a first visit offers the privacy choice and passes axe", async ({
	page,
}) => {
	await page.goto("/app/login");

	const region = page.getByRole("region", { name: "Your privacy choices" });
	await expect(region).toBeVisible();
	await expect(
		region.getByRole("button", { name: "Allow", exact: true }),
	).toBeVisible();
	await expect(
		region.getByRole("button", { name: "Do not allow", exact: true }),
	).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

test("refusing stores the decision, hides the banner and keeps it hidden on reload", async ({
	page,
}) => {
	await page.goto("/app/login");
	await page.getByRole("button", { name: "Do not allow", exact: true }).click();

	await expect(
		page.getByRole("region", { name: "Your privacy choices" }),
	).toHaveCount(0);
	const stored = await page.evaluate(
		(name) => localStorage.getItem(name),
		CONSENT_ENTRY,
	);
	expect(stored).toContain("denied");

	await page.reload();
	await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Your privacy choices" }),
	).toHaveCount(0);
});

test("accepting stores «granted» and hides the banner", async ({ page }) => {
	await page.goto("/app/login");
	await page.getByRole("button", { name: "Allow", exact: true }).click();

	await expect(
		page.getByRole("region", { name: "Your privacy choices" }),
	).toHaveCount(0);
	const stored = await page.evaluate(
		(name) => localStorage.getItem(name),
		CONSENT_ENTRY,
	);
	expect(stored).toContain("granted");
});
