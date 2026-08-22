import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function signUp(page: Page): Promise<void> {
	await page.goto("/app/login");
	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Confirm password" });
	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
}

test("el perfil enlaza a las páginas legales prerrenderizadas (T30)", async ({
	page,
}) => {
	// Sólo el `href`, no que la página cargue: `/privacy.html` y `/terms.html`
	// son ficheros del prerender de T28 y no existen bajo `npm run dev`, que es
	// contra lo que corre este fichero — `apps/web/e2e-landing/landing.spec.ts`
	// es quien comprueba, contra `dist/`, que esas rutas responden 200.
	await signUp(page);
	await page.goto("/app/profile");

	const privacyLink = page.getByRole("link", { name: "Privacy" });
	const termsLink = page.getByRole("link", { name: "Terms" });
	await expect(privacyLink).toHaveAttribute("href", "/privacy.html");
	await expect(termsLink).toHaveAttribute("href", "/terms.html");
	await expect(privacyLink).toHaveAttribute("target", "_blank");
	await expect(termsLink).toHaveAttribute("target", "_blank");
});

test("el perfil no tiene violaciones de accesibilidad", async ({ page }) => {
	await signUp(page);
	await page.goto("/app/profile");
	await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
