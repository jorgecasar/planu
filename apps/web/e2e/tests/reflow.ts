import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** WCAG 2.1 SC 1.4.10 (Reflow): content must fit a 320 CSS px wide window. */
export const REFLOW_VIEWPORT = { width: 320, height: 640 } as const;

/**
 * Asserts that the page does not scroll sideways at the reflow width. The
 * width check proves the viewport really is 320 px, so a test that forgot to
 * resize cannot pass on a wide window.
 */
export async function expectNoHorizontalScroll(
	page: Page,
	label = page.url(),
): Promise<void> {
	await page.setViewportSize(REFLOW_VIEWPORT);
	const { scrollWidth, clientWidth } = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(clientWidth, `${label}: viewport`).toBe(REFLOW_VIEWPORT.width);
	expect(scrollWidth, `${label}: horizontal scroll`).toBeLessThanOrEqual(
		clientWidth,
	);
}
