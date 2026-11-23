import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../e2e/tests/reflow.js";

// WCAG 2.1 SC 1.4.10: the prerendered pages do not scroll sideways at 320 px.

for (const path of ["/", "/en/", "/es/", "/privacy.html", "/terms.html"]) {
	test(`${path} does not scroll sideways at 320 px`, async ({ page }) => {
		const response = await page.goto(path);
		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expectNoHorizontalScroll(page, path);
	});
}
