import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Correo único por ejecución: el emulador conserva los usuarios entre tests. */
const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/**
 * A fresh sign-up has an unverified email, and the guard (T61) sends it to
 * the profile, where the verification notice explains why. Waiting for that
 * exact landing, not just `/app`: the URL is `/app` for an instant before
 * the guard redirects, so asserting it would pass for the wrong reason.
 */
async function expectLandsOnProfileUnverified(page: Page): Promise<void> {
	await expect(page).toHaveURL(/\/app\/profile$/);
	await expect(
		page.getByText(
			"Verify your email so others can invite you to their events.",
		),
	).toBeVisible();
}

test("registrarse deja al usuario dentro de la aplicación, en el perfil hasta verificar", async ({
	page,
}) => {
	await page.goto("/app/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Confirm password" });

	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();

	// La guarda saca del login en cuanto hay sesión, y sin verificar la
	// lleva al perfil.
	await expectLandsOnProfileUnverified(page);
	await expect(
		page.getByRole("banner").getByRole("heading", { name: "planu" }),
	).toBeVisible();
});

test("registrarse funciona igual con la analítica bloqueada (T31)", async ({
	page,
}) => {
	// Simula un bloqueador de verdad, no sólo la ausencia de measurementId en
	// .env.local: intercepta los dominios que Firebase Analytics contactaría y
	// los corta, igual que haría uBlock o el propio navegador con Enhanced
	// Tracking Protection. Si `createAnalyticsAdapter` no tragara el fallo, el
	// registro se rompería aquí.
	await page.route(/google-analytics\.com|googletagmanager\.com/, (route) =>
		route.abort(),
	);

	await page.goto("/app/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Confirm password" });

	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();

	await expectLandsOnProfileUnverified(page);
	await expect(
		page.getByRole("banner").getByRole("heading", { name: "planu" }),
	).toBeVisible();
});

test("las contraseñas que no coinciden no crean cuenta", async ({ page }) => {
	await page.goto("/app/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Confirm password" });

	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("otracosa");
	await panel.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("alert")).toHaveText("Passwords don't match.");
	await expect(page).toHaveURL(/\/app\/login$/);
});

test("credenciales incorrectas no revelan si el correo existe", async ({
	page,
}) => {
	await page.goto("/app/login");

	await page.getByLabel("Email").first().fill("nadie@example.com");
	await page.getByLabel("Password", { exact: true }).first().fill("secret123");
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
});

test("la aplicación autenticada no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.goto("/app/login");

	await page.getByRole("tab", { name: "Create account" }).click();
	const panel = page
		.getByRole("tabpanel")
		.filter({ hasText: "Confirm password" });
	await panel.getByLabel("Email").fill(newEmail());
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByLabel("Confirm password").fill("secret123");
	await panel.getByRole("button", { name: "Create account" }).click();

	// Where a new account really lands, so axe checks a settled page rather
	// than whatever is on screen mid-redirect.
	await expectLandsOnProfileUnverified(page);
	await expect(
		page.getByRole("banner").getByRole("heading", { name: "planu" }),
	).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
