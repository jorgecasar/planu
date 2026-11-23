import { expect, test } from "./fixtures.js";
import { axeBuilder } from "./tests/axe.js";

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

test("el primer Tab llega al enlace para saltar al contenido y lo enfoca", async ({
	page,
}) => {
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();

	await page.keyboard.press("Tab");
	const skip = page.getByRole("link", { name: "Skip to main content" });
	await expect(skip).toBeFocused();
	await expect(skip).toBeInViewport();

	await page.keyboard.press("Enter");
	await expect(page.locator("main")).toBeFocused();
});

test("la pantalla de acceso no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.goto("/app/login");
	await expect(page.getByRole("heading", { name: "planu" })).toBeVisible();

	const results = await axeBuilder(page).analyze();
	expect(results.violations).toEqual([]);
});
