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

async function openEditor(page: Page): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByRole("menuitem", { name: "Create manually" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();
}

/**
 * Un día relativo a hoy, en el formato que espera `<input type="date">`.
 *
 * Relativo y no una fecha fija: un literal se queda en el pasado y el test
 * empieza a fallar solo un día cualquiera.
 */
function dayFromToday(offset: number): string {
	const date = new Date();
	date.setDate(date.getDate() + offset);
	const pad = (value: number) => `${value}`.padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Los eventos que tienen que verse en el calendario son **de hoy**, y no de un
 * día cualquiera.
 *
 * El calendario arranca en el mes en curso, así que un evento a dos días vista
 * cae fuera de la rejilla cada vez que el mes se acaba, y el test empezaría a
 * fallar un día al mes sin que nada se hubiera roto. Hoy siempre está dentro.
 */
async function createEventToday(page: Page, title: string): Promise<void> {
	await createDatedEvent(page, title, 0);
}

async function createDatedEvent(
	page: Page,
	title: string,
	offset: number,
): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Start date").fill(dayFromToday(offset));
	await page.getByLabel("End date").fill(dayFromToday(offset));
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

/** Igual que `createEventToday`, pero con horas: para las vistas de T49. */
async function createEventTodayWithTime(
	page: Page,
	title: string,
	startTime: string,
	endTime: string,
): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Start date").fill(dayFromToday(0));
	await page.getByLabel("Start time").fill(startTime);
	await page.getByLabel("End date").fill(dayFromToday(0));
	await page.getByLabel("End time").fill(endTime);
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

async function createUndatedEvent(page: Page, title: string): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

async function switchTo(page: Page, view: string): Promise<void> {
	await page.getByRole("radio", { name: view, exact: true }).click();
}

/**
 * Espera a que no quede ninguna animación en vuelo.
 *
 * Web Awesome anima con la Web Animations API, y axe mide colores sobre lo que
 * hay pintado: escanear a mitad de un fundido da contrastes que nadie ve.
 * Apagar las animaciones por CSS **no** sirve, porque las lanza el propio
 * componente desde JavaScript.
 *
 * **Hoy no espera nada, y conviene saberlo.** Una revisión instrumentó el bucle
 * y midió `document.getAnimations().length` a ambos lados: cero antes y cero
 * después en las tres vistas, porque conmutar no abre ningún diálogo ni cajón.
 * Se queda como red por dos motivos: cuesta una llamada, y la primera vista que
 * anime al entrar —o el primer `wa-details` que se abra dentro del bucle— la
 * necesitaría sin que nadie se acordara. Lo que **no** hace es sostener la
 * casilla del checkpoint: la evidencia de `plan.md` no la menciona.
 */
async function settle(page: Page): Promise<void> {
	await page.evaluate(() =>
		Promise.all(
			document.getAnimations().map((animation) =>
				animation.finished.catch(() => {
					/* cancelada: también ha terminado */
				}),
			),
		),
	);
}

test("el conmutador lleva a las tres vistas", async ({ page }) => {
	await signUp(page);
	await createEventToday(page, "Concierto de verano");

	// La rejilla de tarjetas es la de siempre: quien no toque el conmutador no
	// puede encontrarse la pantalla cambiada.
	await expect(page.locator("planu-event-groups")).toBeVisible();

	await switchTo(page, "Calendar");
	await expect(page.locator("planu-calendar-view")).toBeVisible();
	await expect(page.locator("planu-event-groups")).toHaveCount(0);

	await switchTo(page, "Agenda");
	await expect(page.locator("planu-agenda-view")).toBeVisible();
	await expect(page.locator("planu-calendar-view")).toHaveCount(0);

	await switchTo(page, "Cards");
	await expect(page.locator("planu-event-groups")).toBeVisible();
});

test("cualquiera de las tres vistas sobrevive a la recarga", async ({
	page,
}) => {
	// Las tres, y no sólo la agenda: persistir «calendar» como «grid» pasaba
	// desapercibido probando una sola. Cada vuelta parte de la vista anterior,
	// así que también se comprueba que se puede volver a Tarjetas.
	await signUp(page);
	await createEventToday(page, "Concierto de verano");

	for (const [view, element] of [
		["Agenda", "planu-agenda-view"],
		["Calendar", "planu-calendar-view"],
		["Cards", "planu-event-groups"],
	]) {
		await switchTo(page, view as string);
		await expect(page.locator(element as string)).toBeVisible();

		await page.reload();

		await expect(
			page.locator(element as string),
			`vista ${view}`,
		).toBeVisible();
		// Y el conmutador dice dónde está: dejarlo marcando otra cosa sería peor
		// que no recordar nada.
		await expect(
			page.getByRole("radio", { name: view as string, exact: true }),
			`vista ${view}`,
		).toBeChecked();
	}
});

test("la agenda respeta el orden elegido", async ({ page }) => {
	// `buildAgenda` tiene su unitario para esto, pero el cableado no tenía
	// ninguno: codificar `DEFAULT_SORT` en la llamada dejaba «lo más lejano
	// primero» sin efecto en la agenda y la suite entera en verde.
	await signUp(page);
	await createDatedEvent(page, "Primero", 1);
	await createDatedEvent(page, "Segundo", 2);
	await switchTo(page, "Agenda");

	const days = page.locator("planu-agenda-view h2.day-title");
	const ascendente = await days.allInnerTexts();
	expect(ascendente).toHaveLength(2);

	await page.getByRole("combobox", { name: "Sort by" }).click();
	await page.getByRole("option", { name: "Date, latest first" }).click();

	await expect(days).toHaveText([...ascendente].reverse());
});

test("los filtros se aplican en el calendario", async ({ page }) => {
	// Los dos eventos son del mismo día, así que ninguno puede desaparecer de la
	// rejilla por caer en otro mes: si uno se va, es por el filtro y por nada
	// más.
	await signUp(page);
	await createEventToday(page, "Concierto de verano");
	await createEventToday(page, "Feria del libro");
	await switchTo(page, "Calendar");

	const grid = page.locator("planu-calendar-view li");
	await expect(grid.filter({ hasText: "Concierto de verano" })).toHaveCount(1);
	await expect(grid.filter({ hasText: "Feria del libro" })).toHaveCount(1);

	await page.getByLabel("Search").fill("Concierto");

	await expect(grid.filter({ hasText: "Concierto de verano" })).toHaveCount(1);
	await expect(grid.filter({ hasText: "Feria del libro" })).toHaveCount(0);
});

test("los filtros se aplican en la agenda", async ({ page }) => {
	await signUp(page);
	await createEventToday(page, "Concierto de verano");
	await createEventToday(page, "Feria del libro");
	await switchTo(page, "Agenda");

	const cards = page.locator("planu-agenda-view planu-event-card");
	await expect(cards).toHaveCount(2);
	// Un solo día, y con su encabezado: es lo que distingue a la agenda de la
	// rejilla de tarjetas. Por clase y no `h2` a secas: los selectores CSS de
	// Playwright atraviesan el shadow DOM, así que `planu-agenda-view h2` casa
	// también con los encabezados internos de los componentes de Web Awesome.
	await expect(page.locator("planu-agenda-view h2.day-title")).toHaveCount(1);

	await page.getByLabel("Search").fill("Concierto");

	await expect(cards).toHaveCount(1);
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Feria del libro" }),
	).toHaveCount(0);
});

test("buscar abre el pliegue de pasados también en la agenda", async ({
	page,
}) => {
	// El escenario importa, y es el mismo error que ya costó una revisión en la
	// rejilla de tarjetas: si la búsqueda sólo casara con pasados, el pliegue se
	// abriría **por otra regla** —son el único grupo con contenido— y el test
	// pasaría sin ejercitar la que aquí se prueba. Con las dos mitades llenas,
	// sólo «el usuario ha pedido algo» explica que se abra.
	await signUp(page);
	await createDatedEvent(page, "Feria de abril", -30);
	await createDatedEvent(page, "Feria de otoño", 30);
	await switchTo(page, "Agenda");

	const fold = page.locator("planu-agenda-view wa-details");
	await expect(fold).toHaveJSProperty("open", false);

	await page.getByLabel("Search").fill("feria");

	await expect(fold).toHaveJSProperty("open", true);
	await expect(
		page.getByRole("heading", { name: "Feria de abril" }),
	).toBeVisible();
});

test("elegir un evento sin fecha en el calendario abre el editor", async ({
	page,
}) => {
	// La rejilla emite `planu-event-picked` y no decide nada: es la vista de
	// eventos la que abre el editor. Sin esto, un evento sin fecha se anuncia en
	// el calendario y no se puede alcanzar desde él.
	await signUp(page);
	await createUndatedEvent(page, "Algún día");
	await switchTo(page, "Calendar");

	await page
		.getByRole("button", {
			name: "1 event without a date is not shown on the calendar",
		})
		.click();
	await page.getByRole("button", { name: "Algún día" }).click();

	await expect(page.getByLabel("Title")).toHaveValue("Algún día");
});

test("las tres vistas no tienen violaciones de accesibilidad", async ({
	page,
}) => {
	// Criterio de aceptación de F5 y del checkpoint C. Un solo test para las
	// tres: el escenario es el mismo y montarlo tres veces cuesta tres altas.
	await signUp(page);
	await createEventToday(page, "Concierto de verano");
	await createUndatedEvent(page, "Algún día");

	for (const [view, element] of [
		["Cards", "planu-event-groups"],
		["Calendar", "planu-calendar-view"],
		["Agenda", "planu-agenda-view"],
	]) {
		await switchTo(page, view as string);
		// Afirmar **qué** se está escaneando, y no sólo que se escaneó tres
		// veces: con el conmutador roto, este bucle mediría Tarjetas tres veces
		// y pasaría igual.
		await expect(
			page.locator(element as string),
			`vista ${view}`,
		).toBeVisible();
		await settle(page);

		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations, `vista ${view}`).toEqual([]);
		// Sin esto, una vista que no llegara a pintarse daría cero violaciones
		// sobre cero elementos y el test no distinguiría eso de estar limpia.
		expect(results.passes.length, `vista ${view}`).toBeGreaterThan(0);
	}
});

test("el orden de encabezados no se rompe al cambiar de vista", async ({
	page,
}) => {
	// h1 planu → h2 grupo, mes o día → h3 tarjeta. El mes del calendario no es
	// un encabezado por sí mismo —el nivel depende de dónde se monte— y quien lo
	// monta tiene que dárselo; sin eso queda fuera de la navegación por
	// encabezados y axe no dice nada.
	await signUp(page);
	await createEventToday(page, "Concierto de verano");

	await switchTo(page, "Calendar");
	await expect(
		page.locator("planu-calendar-view h2#month-title"),
	).toBeVisible();

	await switchTo(page, "Agenda");
	await expect(page.locator("planu-agenda-view h2.day-title")).toHaveCount(1);
	// Por rol y nivel, que es lo que oye quien navega por encabezados: el
	// selector CSS encontraría además los encabezados de los diálogos que la
	// tarjeta trae dentro y que nadie está viendo.
	await expect(
		page.getByRole("heading", { name: "Concierto de verano", level: 3 }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano", level: 2 }),
	).toHaveCount(0);
});

test.describe("navegador en alemán, interfaz en inglés", () => {
	test.use({ locale: "de-DE" });

	test("la agenda escribe los días en el idioma de la interfaz", async ({
		page,
	}) => {
		// El caso que `src/i18n/localization.ts` avisa por su nombre y que una
		// revisión encontró vivo: sin pasarle el locale, `Intl` cae al del
		// navegador y los encabezados de día salían en alemán dentro de una
		// pantalla en inglés. El alemán no está traducido, así que la interfaz
		// sirve inglés y **eso** es lo que manda.
		await signUp(page);
		await createEventToday(page, "Concierto de verano");
		await switchTo(page, "Agenda");

		const hoy = new Date();
		const enIngles = new Intl.DateTimeFormat("en", { weekday: "long" }).format(
			hoy,
		);
		const enAleman = new Intl.DateTimeFormat("de", { weekday: "long" }).format(
			hoy,
		);

		const dia = page.locator("planu-agenda-view h2.day-title");
		await expect(dia).toContainText(enIngles);
		await expect(dia).not.toContainText(enAleman);
	});
});

// --- Hora en agenda y mes (T49) ---------------------------------------------

test("la hora se ve en la celda del mes cuando el evento la tiene", async ({
	page,
}) => {
	await signUp(page);
	await createEventTodayWithTime(page, "Cena de hoy", "19:30", "23:00");
	await switchTo(page, "Calendar");

	const grid = page.locator("planu-calendar-view li");
	await expect(grid.filter({ hasText: "7:30 PM Cena de hoy" })).toHaveCount(1);
});

test("un evento de día completo no muestra hora en la celda del mes", async ({
	page,
}) => {
	await signUp(page);
	await createEventToday(page, "Feria del libro");
	await switchTo(page, "Calendar");

	const grid = page.locator("planu-calendar-view li");
	await expect(grid.filter({ hasText: "Feria del libro" })).toHaveText(
		"Feria del libro",
	);
});

test("dos eventos de hoy salen ordenados por hora en la celda del mes", async ({
	page,
}) => {
	await signUp(page);
	await createEventTodayWithTime(page, "Tarde", "18:00", "19:00");
	await createEventTodayWithTime(page, "Temprano", "09:00", "10:00");
	await switchTo(page, "Calendar");

	// Se busca la celda de hoy por su marca `aria-current="date"`, y dentro de
	// ella el orden de los `<li>`: es donde viven los dos eventos.
	const items = page
		.locator('planu-calendar-view [aria-current="date"] li')
		.allTextContents();
	await expect.poll(() => items).toEqual(["9:00 AM Temprano", "6:00 PM Tarde"]);
});

test("la hora se ve en la agenda, heredada de la tarjeta", async ({ page }) => {
	// La agenda no pinta la hora por su cuenta: hereda `planu-event-card`, así
	// que basta con que la tarjeta la diga, sin cambios en la vista.
	await signUp(page);
	await createEventTodayWithTime(page, "Cena de hoy", "19:30", "23:00");
	await switchTo(page, "Agenda");

	await expect(
		page.locator("planu-agenda-view").getByText(/7:30 PM.*11:00 PM/),
	).toBeVisible();
});
