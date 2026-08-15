import { expect, test } from "@playwright/test";

/**
 * El idioma sale del navegador, así que cada caso necesita su propio contexto.
 * Los demás e2e corren con el `en-US` por defecto de Playwright.
 */

test.describe("navegador en español", () => {
	test.use({ locale: "es-ES" });

	test("la interfaz se muestra en español", async ({ page }) => {
		await page.goto("/login");

		await expect(page.getByRole("tab", { name: "Entrar" })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Crear cuenta" })).toBeVisible();
		// Hay un campo de correo por pestaña, de ahí el first().
		await expect(page.getByLabel("Correo electrónico").first()).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Continuar con Google" }),
		).toBeVisible();
	});

	test("el atributo lang del documento acompaña al idioma", async ({ page }) => {
		await page.goto("/login");
		// Importa para lectores de pantalla y para la traducción del navegador.
		await expect(page.locator("html")).toHaveAttribute("lang", "es");
	});

	test("los errores de validación también se traducen", async ({ page }) => {
		await page.goto("/login");
		await page.getByRole("tab", { name: "Crear cuenta" }).click();
		const panel = page
			.getByRole("tabpanel")
			.filter({ hasText: "Confirmar contraseña" });

		await panel.getByLabel("Correo electrónico").fill("a@b.com");
		await panel.getByLabel("Contraseña", { exact: true }).fill("secret123");
		await panel.getByLabel("Confirmar contraseña").fill("otracosa");
		await panel.getByRole("button", { name: "Crear cuenta" }).click();

		await expect(page.getByRole("alert")).toHaveText(
			"Las contraseñas no coinciden.",
		);
	});
});

test.describe("navegador en un idioma sin traducir", () => {
	test.use({ locale: "ja-JP" });

	test("cae a inglés", async ({ page }) => {
		await page.goto("/login");

		await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("lang", "en");
	});
});

test.describe("navegador en una variante regional del español", () => {
	test.use({ locale: "es-AR" });

	test("es-AR se sirve en español", async ({ page }) => {
		await page.goto("/login");
		await expect(page.getByRole("tab", { name: "Entrar" })).toBeVisible();
	});
});
