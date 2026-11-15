import { expect, type Page } from "@playwright/test";

/** Ownership, dates and tags live in the «Filters» drawer (GH-188). */
export async function openFilters(page: Page): Promise<void> {
	// Its own «shown» event, not its fields: axe scanning it mid-slide
	// measured its labels at 1.24:1. `getAnimations()` returned too early.
	const shown = page.locator("planu-event-filters").evaluate(
		(host) =>
			new Promise<void>((resolve) => {
				host.shadowRoot
					?.querySelector("wa-drawer")
					?.addEventListener("wa-after-show", () => resolve(), {
						once: true,
					});
			}),
	);
	await page.getByRole("button", { name: /^Filters/ }).click();
	await shown;
}

export async function closeFilters(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.getByRole("radiogroup", { name: "Show" })).toBeHidden();
}
