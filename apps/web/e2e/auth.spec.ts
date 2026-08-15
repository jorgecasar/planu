import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Correo único por ejecución: el emulador conserva los usuarios entre tests. */
const newEmail = () => `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

test("registrarse deja al usuario dentro de la aplicación", async ({ page }) => {
	await page.goto("/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page.getByRole("tabpanel").filter({ hasText: "Confirm password" });

	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();

	// La guarda saca del login en cuanto hay sesión.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();
});

test("las contraseñas que no coinciden no crean cuenta", async ({ page }) => {
	await page.goto("/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page.getByRole("tabpanel").filter({ hasText: "Confirm password" });

	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("otracosa");
	await panel.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("alert")).toHaveText("Passwords don't match.");
	await expect(page).toHaveURL(/\/login$/);
});

test("credenciales incorrectas no revelan si el correo existe", async ({
	page,
}) => {
	await page.goto("/login");

	await page.getByLabel("Email").first().fill("nadie@example.com");
	await page.getByLabel("Password", { exact: true }).first().fill("secret123");
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
});

test("la aplicación autenticada no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.goto("/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page.getByRole("tabpanel").filter({ hasText: "Confirm password" });
	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
