import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const newEmail = () =>
	`user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Cada test parte de una cuenta nueva para no compartir eventos. */
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

/** Abre el editor manual: el botón principal es ahora un menú de dos opciones. */
async function openEditor(page: Page): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByRole("menuitem", { name: "Create manually" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();
}

async function createEvent(page: Page, title: string): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Description").fill(`About ${title}`);
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	// El diálogo es modal: hasta que la animación de cierre termina, el resto de
	// la página sigue inerte y cualquier interacción se pierde. Se espera al
	// <dialog> nativo y no al formulario, que se desmonta de inmediato.
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

test("una cuenta nueva empieza sin eventos", async ({ page }) => {
	await signUp(page);
	await expect(page.getByText("You have no events yet.")).toBeVisible();
});

test("crear un evento lo muestra en el listado", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(page.getByText("Madrid")).toBeVisible();
	// Sin fechas el evento sigue siendo válido y debe decirlo.
	await expect(page.getByText("No specific date")).toBeVisible();
});

test("la búsqueda acota el listado", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");
	await createEvent(page, "Cena de empresa");

	await page.getByLabel("Search").fill("concierto");

	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Cena de empresa" }),
	).toBeHidden();
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

	await expect(
		page.getByRole("heading", { name: "Concierto de invierno" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeHidden();
});

test("borrar pide confirmación y luego elimina", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByRole("button", { name: "Delete" }).first().click();
	await expect(page.getByText(/This permanently deletes/)).toBeVisible();
	await page
		.getByRole("button", { name: "Delete", exact: true })
		.last()
		.click();

	await expect(page.getByText("You have no events yet.")).toBeVisible();
});

test("reabrir el editor no arrastra los datos del evento anterior", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await openEditor(page);

	// Lit no re-escribe una propiedad cuyo valor no ha cambiado para él, y no
	// se entera de lo que teclea el usuario: sin recrear el formulario, aquí
	// seguiría puesto "Concierto de verano".
	await expect(page.getByLabel("Title")).toHaveValue("");
	await expect(page.getByLabel("Location")).toHaveValue("");
});

test("editar carga los datos del evento en el formulario", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByRole("button", { name: "Edit" }).click();

	await expect(page.getByLabel("Title")).toHaveValue("Concierto de verano");
	await expect(page.getByLabel("Location")).toHaveValue("Madrid");
});

test("un título demasiado corto no guarda", async ({ page }) => {
	await signUp(page);

	await openEditor(page);
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

test("recargar la página estando autenticado mantiene la sesión y el listado", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.reload();

	// Al recargar, el router resuelve la ruta antes de saber si hay sesión y la
	// rechaza; la reevaluación posterior es la que tiene que traer el listado.
	await expect(page).toHaveURL(/\/app$/);
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
});
