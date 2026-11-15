import { expect, type Page } from "@playwright/test";

/**
 * Since GH-188, every card action but «Edit» sits behind the card's «⋯»
 * menu, whose name carries the event's title. Without a title, the first
 * card's menu: most specs have a single event on screen.
 */
export async function openCardMenu(page: Page, title?: string): Promise<void> {
	const trigger = title
		? page.getByRole("button", { name: `More actions for “${title}”` })
		: page.getByRole("button", { name: /^More actions for / }).first();
	await trigger.click();
	await expect(page.getByRole("menu")).toBeVisible();
}

export async function cardAction(
	page: Page,
	action: "Share" | "Delete" | "Leave",
	title?: string,
): Promise<void> {
	await openCardMenu(page, title);
	const item = page.getByRole("menuitem", { name: action, exact: true });
	await item.click();
	// The menu fades out with the Web Animations API, and axe measures colours
	// on whatever is painted: scanning mid-fade read 1.15:1 on its items.
	await expect(item).toBeHidden();
}
