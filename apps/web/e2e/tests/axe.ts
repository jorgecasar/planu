import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The conformance target is WCAG 2.1 level AA (EN 301 549 / EAA). The tags are
 * pinned so that the scan means the same thing whatever axe-core ships as its
 * default rule set: an unpinned scan also runs best-practice rules and drifts
 * with every upgrade.
 */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export const VIEWPORTS = {
	desktop: { width: 1280, height: 800 },
	mobile: { width: 375, height: 667 },
} as const;

/** The one place an AxeBuilder is created. Chain `.include()` on the result. */
export function axeBuilder(page: Page): AxeBuilder {
	return new AxeBuilder({ page }).withTags(AXE_TAGS);
}

/**
 * Scans the page with the pinned tags and asserts there is no violation. The
 * second assertion keeps a scan that looked at nothing from passing.
 */
export async function expectNoViolations(
	page: Page,
	label = page.url(),
): Promise<void> {
	const results = await axeBuilder(page).analyze();
	expect(results.violations, label).toEqual([]);
	expect(
		results.passes.length,
		`${label}: nothing was scanned`,
	).toBeGreaterThan(0);
}

/** Runs `check` once per viewport, desktop first, then mobile. */
export async function atEachViewport(
	page: Page,
	check: (name: keyof typeof VIEWPORTS) => Promise<void>,
): Promise<void> {
	for (const [name, size] of Object.entries(VIEWPORTS)) {
		await page.setViewportSize(size);
		await check(name as keyof typeof VIEWPORTS);
	}
}
