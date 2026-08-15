import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Cada test parte de una cuenta nueva para no compartir eventos. */
async function signUp(page: Page): Promise<void> {
	await page.goto("/login");
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

async function createEvent(page: Page, title: string): Promise<void> {
	// En el estado vacío hay dos botones que abren el editor.
	await page
		.getByRole("button", { name: /New event|Create your first event/ })
		.first()
		.click();
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Description").fill(`About ${title}`);
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	// El diálogo es modal: hasta que termina de cerrarse el resto de la página
	// sigue inerte y cualquier interacción se pierde.
	await expect(page.getByLabel("Title")).toBeHidden();
}

test("una cuenta nueva empieza sin eventos", async ({ page }) => {
	await signUp(page);
	await expect(page.getByText("You have no events yet.")).toBeVisible();
});

test("crear un evento lo muestra en el listado", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await expect(page.getByRole("heading", { name: "Concierto de verano" })).toBeVisible();
	await expect(page.getByText("Madrid")).toBeVisible();
	// Sin fechas el evento sigue siendo válido y debe decirlo.
	await expect(page.getByText("No specific date")).toBeVisible();
});

test("la búsqueda acota el listado", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");
	await createEvent(page, "Cena de empresa");

	await page.getByLabel("Search").fill("concierto");

	await expect(page.getByRole("heading", { name: "Concierto de verano" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Cena de empresa" })).toBeHidden();
});

test("una búsqueda sin resultados se distingue de no tener eventos", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByLabel("Search").fill("zzzz");

	await expect(
		page.getByText("No events match your search or date filter."),
	).toBeVisible();
	await expect(page.getByText("You have no events yet.")).toBeHidden();
});

test("editar un evento actualiza la tarjeta", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByRole("button", { name: "Edit" }).click();
	await page.getByLabel("Title").fill("Concierto de invierno");
	await page.getByRole("button", { name: "Save event" }).click();

	await expect(page.getByRole("heading", { name: "Concierto de invierno" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Concierto de verano" })).toBeHidden();
});

test("borrar pide confirmación y luego elimina", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByRole("button", { name: "Delete" }).first().click();
	await expect(page.getByText(/This permanently deletes/)).toBeVisible();
	await page.getByRole("button", { name: "Delete", exact: true }).last().click();

	await expect(page.getByText("You have no events yet.")).toBeVisible();
});

test("un título demasiado corto no guarda", async ({ page }) => {
	await signUp(page);

	// En el estado vacío hay dos botones que abren el editor.
	await page
		.getByRole("button", { name: /New event|Create your first event/ })
		.first()
		.click();
	await page.getByLabel("Title").fill("ab");
	await page.getByRole("button", { name: "Save event" }).click();

	// La restricción nativa (minlength) corta el envío antes de que corra la
	// validación con Zod: no hay alerta, el diálogo simplemente no cierra.
	await expect(page.getByLabel("Title")).toBeVisible();
	await expect(page.locator("planu-event-card")).toHaveCount(0);
});

test("el listado con eventos no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});
