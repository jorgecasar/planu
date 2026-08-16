import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("sin sesión, la portada redirige al acceso", async ({ page }) => {
	await page.goto("/app");

	// La guarda es lo único que protege las rutas privadas en el cliente.
	await expect(page).toHaveURL(/\/app\/login$/);
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();
});

test("el formulario de acceso ofrece entrar, registrarse y Google", async ({
	page,
}) => {
	await page.goto("/app/login");

	await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Continue with Google" }),
	).toBeVisible();
});

test("la pantalla de acceso no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
