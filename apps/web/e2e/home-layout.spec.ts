import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { signUpVerified } from "./verified-account.js";

const PHONE = { width: 390, height: 844 };

async function createEvent(
	page: Page,
	title: string,
	extra: { start?: string; description?: string; tags?: string[] } = {},
): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();
	await page.getByLabel("Title").fill(title);
	if (extra.description)
		await page.getByLabel("Description").fill(extra.description);
	if (extra.start) await page.getByLabel("Start date").fill(extra.start);
	for (const tag of extra.tags ?? []) {
		await page.getByRole("textbox", { name: "Tags" }).fill(tag);
		await page.getByRole("textbox", { name: "Tags" }).press("Enter");
	}
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Whether the whole box of `locator` lies inside the viewport. */
async function inViewport(page: Page, locator: Locator): Promise<boolean> {
	const box = await locator.boundingBox();
	const viewport = page.viewportSize();
	if (!box || !viewport) return false;
	return (
		box.y >= 0 &&
		box.x >= 0 &&
		box.y + box.height <= viewport.height &&
		box.x + box.width <= viewport.width
	);
}

/** A day relative to today, as `<input type="date">` wants it. */
function dayFromToday(offset: number): string {
	const date = new Date();
	date.setDate(date.getDate() + offset);
	const pad = (value: number) => `${value}`.padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("en el móvil, el primer evento y «Nuevo evento» se ven sin hacer scroll", async ({
	page,
}) => {
	await page.setViewportSize(PHONE);
	await signUpVerified(page);
	await createEvent(page, "Concierto de verano", {
		start: dayFromToday(3),
		description: "Al aire libre, en el parque. ".repeat(6),
		tags: ["música", "verano", "aire libre"],
	});
	await createEvent(page, "Cena de empresa", { start: dayFromToday(10) });
	await createEvent(page, "Ideas para el viaje");
	await page.reload();

	const first = page.locator("planu-event-card").first();
	await expect(first).toBeVisible();
	expect(await inViewport(page, first.getByRole("heading"))).toBe(true);
	const newEvent = page.getByRole("button", { name: "New event" });
	expect(await inViewport(page, newEvent)).toBe(true);
	const firstActions = first.getByRole("button", { name: /^More actions/ });
	expect(await inViewport(page, firstActions)).toBe(true);
	const actionsBox = await firstActions.boundingBox();
	const newBox = await newEvent.boundingBox();
	expect((actionsBox?.y ?? 0) + (actionsBox?.height ?? 0)).toBeLessThanOrEqual(
		newBox?.y ?? 0,
	);

	// Fixed to the bottom edge: still there with the list scrolled to its
	// last card, and not covering that card's actions.
	const last = page.locator("planu-event-card").last();
	await page.evaluate(() =>
		window.scrollTo(0, document.documentElement.scrollHeight),
	);
	expect(await inViewport(page, last)).toBe(true);
	expect(await inViewport(page, newEvent)).toBe(true);
	const lastBox = await last.boundingBox();
	const buttonBox = await newEvent.boundingBox();
	expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(
		buttonBox?.y ?? 0,
	);

	// The export notice (one undated event is left out) sits above it.
	await page.getByRole("button", { name: "Export calendar" }).click();
	await page.getByRole("menuitem", { name: "Download .ics file" }).click();
	// Not scanned mid-fade: the menu leaves with an animation.
	await expect(
		page.getByRole("menuitem", { name: "Download .ics file" }),
	).toBeHidden();
	await expect(page.getByRole("alert")).toBeVisible();
	const notice = await page.getByRole("alert").boundingBox();
	expect((notice?.y ?? 0) + (notice?.height ?? 0)).toBeLessThanOrEqual(
		buttonBox?.y ?? 0,
	);

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

test("en escritorio, «Nuevo evento» sigue en la barra", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await signUpVerified(page);

	const newEvent = page.locator("planu-events-view wa-button.new");
	await expect(newEvent).toBeVisible();
	expect(
		await newEvent.evaluate((el) => getComputedStyle(el).position),
	).not.toBe("fixed");
	// Same row as the view and sort controls, not detached from them.
	const views = await page
		.locator("planu-events-view wa-radio-group.views")
		.boundingBox();
	const button = await newEvent.boundingBox();
	expect(Math.abs((views?.y ?? 0) - (button?.y ?? 0))).toBeLessThan(40);
});

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
