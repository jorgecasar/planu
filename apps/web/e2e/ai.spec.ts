import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signUpVerified } from "./verified-account.js";

/** PNG de 1x1 píxel, suficiente para ejercitar la subida. */
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

/**
 * Verificada, no sólo creada: ADR 0011 exige un email verificado para usar
 * eventos (docs/adr/0011-verificacion-de-email-obligatoria.md). El guard
 * (T61) lleva al perfil a una cuenta sin verificar y, con T60, las reglas
 * le deniegan crear, leer o editar cualquier evento.
 */
async function signUp(page: Page): Promise<void> {
	await signUpVerified(page);
}

test("con IA disponible, la imagen y el título salen a la vez en el mismo diálogo, sin menú previo", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	// Ya no hay que decidir a ciegas entre "a mano" o "con IA": el único botón
	// lleva directo al formulario, con las dos ofertas dentro.
	await expect(page.getByRole("menuitem")).toHaveCount(0);
	await expect(page.getByLabel("Event image")).toBeVisible();
	await expect(page.getByLabel("Title")).toBeVisible();
});

test("el texto pegado se ofrece junto a la imagen, y su fallo tampoco bloquea", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	// Las dos entradas conviven en el mismo diálogo: si el campo de texto
	// hubiera sustituido al de imagen, esto lo diría.
	await expect(page.getByLabel("Event image")).toBeVisible();

	const generar = page.getByRole("button", { name: "Generate from text" });
	// Sin texto no hay nada que generar: el botón lo dice en vez de fallar luego.
	await expect(generar).toBeDisabled();

	// El contador hace visible el tope antes de chocar con él. Se escapó de la
	// revisión: `?withCount` pone un atributo que no existe, así que el campo se
	// veía bien y no contaba nada.
	await expect(page.getByText("0 / 2000")).toBeVisible();

	// Un texto que de verdad no describe ningún evento, y no una invitación
	// perfectamente válida: con la segunda, la aserción de abajo sólo era cierta
	// porque aquí no hay IA, y se habría roto el día que la generación funcione.
	// Medido contra Gemini Nano, éste es además el texto que hace que el modelo
	// lance un error en vez de contestar.
	await page
		.getByLabel("Or paste the text of the event")
		.fill("Recuerda comprar leche y pilas.");
	await expect(generar).toBeEnabled();
	await generar.click();

	// El navegador dice tener el modelo listo y aun así no sale nada: la culpa
	// se le echa al texto, no a la IA, y se ofrece salida.
	await expect(page.getByRole("alert")).toContainText(
		"no event could be found in that text",
		{ ignoreCase: true },
	);

	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("button", { name: "New event" })).toBeEnabled();
});

test("pasarse del tope se explica, en vez de recortar el pegado en silencio", async ({
	page,
}) => {
	// El campo llevaba `maxlength`, que **recorta el pegado sin decir nada**:
	// justo el truncado silencioso que el tope venía a impedir. Quien pegaba
	// 2500 caracteres se quedaba con 2000 y el modelo contestaba sobre la mitad.
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	const campo = page.getByLabel("Or paste the text of the event");
	await campo.fill("a".repeat(2500));

	// Nada se ha perdido por el camino…
	await expect(campo).toHaveValue("a".repeat(2500));
	await expect(page.getByText("2500 / 2000")).toBeVisible();
	// …y se dice qué hacer, con el botón cerrado hasta entonces.
	await expect(page.getByText("That text is too long")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Generate from text" }),
	).toBeDisabled();
});

test("si la IA no está lista lo dice y no bloquea el alta manual", async ({
	page,
}) => {
	// Se fija el estado en vez de confiar en lo que traiga el Chromium
	// instalado: el de Playwright sí expone LanguageModel y responde
	// "downloadable", así que sin esto el test pasaría por la razón equivocada
	// y se rompería solo con el próximo bump de Playwright.
	//
	// «downloadable» y no «available» a propósito: es el estado en el que un
	// fallo **sí** se explica por la IA, y es la rama que este test defiende.
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "downloadable" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	// Y se avisa de la descarga antes de empezar, no después.
	await expect(
		page.getByText("your browser downloads the AI model"),
	).toBeVisible();

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

// --- Hour extracted by the AI (T44–T54) --------------------------------------
//
// Firebase AI Logic, in `only_on_device` mode, resolves the model through
// `window.LanguageModel.create()` and then calls `session.prompt(...)` — see
// `@firebase/ai`'s `ChromeAdapterImpl`. Mocking those two calls, not just
// `availability` as in the tests above, exercises the full path — image →
// extraction → editor — without depending on a real model, which is exactly
// what this environment doesn't have.

async function mockLanguageModelResponse(
	page: Page,
	json: Record<string, unknown>,
): Promise<void> {
	await page.addInitScript((text: string) => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: {
				availability: async () => "available",
				create: async () => ({ prompt: async () => text }),
			},
			configurable: true,
		});
	}, JSON.stringify(json));
}

test("una imagen con hora llega al editor con la hora puesta", async ({
	page,
}) => {
	await mockLanguageModelResponse(page, {
		title: "Cena de fin de curso",
		description: "Con el equipo",
		location: "Madrid",
		startDate: "2026-07-04T21:00",
		endDate: "2026-07-04T23:30",
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	await page.getByLabel("Event image").setInputFiles({
		name: "cartel.png",
		mimeType: "image/png",
		buffer: PIXEL,
	});

	await expect(page.getByLabel("Title")).toHaveValue("Cena de fin de curso");
	// What this test guards: the hour arrives already set, not empty. Without
	// `allDay`'s computation in `parseGeneratedEvent`, `draft.allDay` arrived
	// `undefined` and the template treated it as all-day — the time fields
	// looked empty even though `startDate` carried the real hour.
	await expect(page.getByLabel("Start time")).toHaveValue("21:00");
	await expect(page.getByLabel("End time")).toHaveValue("23:30");
});

test("una imagen sin hora deja los campos de hora vacíos, no en 00:00", async ({
	page,
}) => {
	await mockLanguageModelResponse(page, {
		title: "Feria del libro",
		startDate: "2026-06-20",
		endDate: "2026-06-22",
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();

	await page.getByLabel("Event image").setInputFiles({
		name: "cartel.png",
		mimeType: "image/png",
		buffer: PIXEL,
	});

	await expect(page.getByLabel("Title")).toHaveValue("Feria del libro");
	await expect(page.getByLabel("Start time")).toHaveValue("");
	await expect(page.getByLabel("End time")).toHaveValue("");
});

// --- Accesibilidad del formulario, con y sin el bloque de IA (T-nuevo-flujo) --
//
// El bloque se monta o no dentro del mismo `<form>` según `aiAvailable`: cada
// rama tiene su propia estructura DOM (fieldset, leyenda, controles propios) y
// necesita su propio escaneo — uno no cubre al otro.

test("el formulario con el bloque de IA visible no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();
	await expect(page.getByLabel("Event image")).toBeVisible();

	const resultados = await new AxeBuilder({ page })
		.include([["planu-app", "planu-events-view", "planu-event-editor"]])
		.analyze();
	expect(resultados.violations).toEqual([]);
	expect(resultados.passes.length).toBeGreaterThan(0);
});

test("el formulario sin IA disponible no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "unavailable" },
			configurable: true,
		});
	});
	await signUp(page);
	await page.getByRole("button", { name: "New event" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();

	const resultados = await new AxeBuilder({ page })
		.include([["planu-app", "planu-events-view", "planu-event-editor"]])
		.analyze();
	expect(resultados.violations).toEqual([]);
	expect(resultados.passes.length).toBeGreaterThan(0);
});
