import { expect, type Page, test } from "@playwright/test";

const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** PNG de 1x1 píxel, suficiente para ejercitar la subida. */
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

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

test("la generación desde imagen se ofrece junto al alta manual", async ({
	page,
}) => {
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	await expect(
		page.getByRole("menuitem", { name: "Create manually" }),
	).toBeVisible();
	await expect(
		page.getByRole("menuitem", { name: "Generate from an image" }),
	).toBeVisible();
});

test("si la IA no está disponible lo dice y no bloquea el alta manual", async ({
	page,
}) => {
	// Se fija el estado en vez de confiar en lo que traiga el Chromium
	// instalado: el de Playwright sí expone LanguageModel y responde
	// "downloadable", así que sin esto el test pasaría por la razón equivocada
	// y se rompería solo con el próximo bump de Playwright.
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByRole("menuitem", { name: "Generate from an image" }).click();

	await page.getByLabel("Event image").setInputFiles({
		name: "cartel.png",
		mimeType: "image/png",
		buffer: PIXEL,
	});

	// En este entorno no hay IA integrada ni backend en la nube configurado.
	// Lo importante es que el fallo se explique y deje salida, no que reviente.
	await expect(page.getByRole("alert")).toContainText(
		"you can still create the event by hand",
		{ ignoreCase: true },
	);

	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("button", { name: "New event" })).toBeEnabled();
});
