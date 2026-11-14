import { expect, test } from "@playwright/test";
import { signUpVerified } from "./verified-account.js";

/**
 * The home screen's layout (GH-188): what fits above the first event.
 *
 * Geometry, not DOM: every control here was already in the page before
 * this issue, and the problem was where they ended up.
 */

test("vista y orden caben en una fila compacta", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await signUpVerified(page);

	const views = page.locator("planu-events-view wa-radio-group.views");
	const sort = page.locator("planu-events-view .view-row wa-select");
	await expect(views).toBeVisible();

	const viewsBox = await views.boundingBox();
	const sortBox = await sort.boundingBox();
	// Same row: the two controls share a vertical centre.
	expect(
		Math.abs(
			(viewsBox?.y ?? 0) +
				(viewsBox?.height ?? 0) / 2 -
				((sortBox?.y ?? 0) + (sortBox?.height ?? 0) / 2),
		),
	).toBeLessThan(4);
	// Compact: a label above the buttons instead of beside them would
	// roughly double this.
	expect(viewsBox?.height ?? 0).toBeLessThan(44);
});

test("en el móvil, las etiquetas de vista y orden no se parten", async ({
	page,
}) => {
	// At 390 the three controls cannot share one row with their labels
	// visible (254 + 208 px against 336), so each takes a compact row; what
	// must not happen is «Sort by» breaking onto two lines.
	await page.setViewportSize({ width: 390, height: 844 });
	await signUpVerified(page);

	for (const control of ["wa-radio-group.views", "wa-select"]) {
		const lines = await page
			.locator(`planu-events-view .view-row ${control}`)
			.evaluate((el) => {
				const label = el.shadowRoot?.querySelector(
					'[part~="form-control-label"]',
				);
				if (!label) return 0;
				const { fontSize, lineHeight } = getComputedStyle(label);
				const line =
					Number.parseFloat(lineHeight) || 1.5 * Number.parseFloat(fontSize);
				return Math.round(label.getBoundingClientRect().height / line);
			});
		expect(lines, control).toBe(1);
	}
});
