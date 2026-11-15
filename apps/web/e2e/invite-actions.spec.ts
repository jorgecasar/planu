import { expect, test } from "@playwright/test";
import { cardAction } from "./tests/card-actions.js";
import { createVerifiedAccount, newEmail, signIn } from "./verified-account.js";

test("after inviting, the owner can mail or copy a link that carries no email", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const owner = newEmail();
	const guest = newEmail();
	const title = `Evento ${Math.random().toString(36).slice(2, 7)}`;
	await createVerifiedAccount(page, owner);
	await signIn(page, owner);
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();

	await cardAction(page, "Share");
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();

	const mail = page.getByRole("link", { name: "Send by email" });
	await expect(mail).toHaveAttribute("href", /^mailto:/);
	await page.getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByText("Link copied.")).toBeVisible();

	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URL(copied).pathname).toBe("/app/login");
	expect(copied).not.toContain(guest);
	expect(copied).not.toContain(title);
});
