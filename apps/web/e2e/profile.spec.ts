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

test("el menú de la cabecera lleva de verdad a /app/profile", async ({
	page,
}) => {
	// Reproduce el bug tal cual se reportó: clic en el menú, no `page.goto()`
	// directo a la ruta. `#onMenuSelect` navegaba a `/profile`, que sólo
	// existe como redirect 301 en `firebase.json` — Hosting lo aplica, pero
	// `@lit-labs/router` no la reconoce, así que el clic no navegaba a
	// ningún sitio. Sólo un refresco, que sí pasa por Hosting, disimulaba el
	// fallo; los tests que ya había aquí usaban `page.goto("/app/profile")`
	// directo y por eso ninguno lo cazó.
	await signUp(page);
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();

	// El botón de la cabecera es el único dentro de `banner`: `label` es el
	// email generado al azar en `signUp`, así que se localiza por posición,
	// no por texto impredecible.
	await page.getByRole("banner").getByRole("button").click();
	await page.getByRole("menuitem", { name: "Profile" }).click();

	await expect(page).toHaveURL(/\/app\/profile$/);
	await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
});

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
