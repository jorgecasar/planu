import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signUpVerified } from "./verified-account.js";

/**
 * Cada test parte de una cuenta nueva para no compartir eventos.
 *
 * Verificada, no sólo creada: T60 exige un email verificado para crear, leer
 * o editar cualquier evento (docs/adr/0011-verificacion-de-email-obligatoria.md),
 * y esta suite necesita hacer las tres cosas.
 */
async function signUp(page: Page): Promise<void> {
	await signUpVerified(page);
}

/** Abre el editor: un único botón lleva directo al formulario. */
async function openEditor(page: Page): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
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

/** Como `createEvent`, pero pasando por el campo de etiquetas. */
async function createTaggedEvent(
	page: Page,
	title: string,
	tags: string[],
): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	for (const tag of tags) {
		// Por rol y no `getByLabel("Tags")`: eso casa además con la lista
		// «Chosen tags», y Playwright aborta por ambigüedad en cuanto hay una
		// etiqueta puesta.
		const campo = page.getByRole("textbox", { name: "Tags" });
		await campo.fill(tag);
		// Intro y no coma: la coma es un carácter válido dentro de una etiqueta.
		await campo.press("Enter");
	}
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
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
		page.getByText("No events match your search, tags or date filter."),
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

test("una etiqueta se guarda, se normaliza y se ve en la tarjeta", async ({
	page,
}) => {
	await signUp(page);
	// Con mayúsculas y espacios de sobra: debe llegar normalizada al listado.
	await createTaggedEvent(page, "Concierto de verano", ["  Música  "]);

	await expect(page.getByRole("listitem").getByText("música")).toBeVisible();
});

test("el filtro por etiquetas combina con Y y se puede limpiar", async ({
	page,
}) => {
	await signUp(page);
	await createTaggedEvent(page, "Concierto de verano", ["música", "verano"]);
	await createTaggedEvent(page, "Cena de empresa", ["música"]);

	// Se pulsa el componente y no su `input` interno: `wa-checkbox` interpone un
	// `<span part="control">` encima, así que `check()` sobre el input se queda
	// esperando para siempre. Pulsar el host es además lo que hace una persona.
	const casilla = (tag: string) => page.locator(`wa-checkbox[value="${tag}"]`);

	// Una etiqueta: los dos eventos la llevan.
	await casilla("música").click();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Cena de empresa" }),
	).toBeVisible();

	// Dos etiquetas: sólo el que lleva las dos. Con O saldrían los dos.
	await casilla("verano").click();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Cena de empresa" }),
	).toBeHidden();

	// Y al limpiar, la casilla tiene que quedar desmarcada además de que
	// reaparezcan los eventos: es justo lo que `?checked` no hacía.
	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(
		page.getByRole("heading", { name: "Cena de empresa" }),
	).toBeVisible();
	// Se afirma sobre el `input` interno y no sobre el host, que no es un
	// checkbox nativo. Y es la aserción que importa de todo el test: es
	// exactamente lo que `?checked` no conseguía, porque su atributo mapea a
	// `defaultChecked` y el componente lo ignora tras el primer clic.
	await expect(
		page.getByRole("checkbox", { name: "música" }),
	).not.toBeChecked();
	await expect(
		page.getByRole("checkbox", { name: "verano" }),
	).not.toBeChecked();
});

test("una etiqueta puesta se puede quitar con el teclado", async ({ page }) => {
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Concierto de verano");
	await page.getByRole("textbox", { name: "Tags" }).fill("música");
	await page.getByRole("textbox", { name: "Tags" }).press("Enter");

	// El botón de borrado que trae wa-tag sale con tabindex -1 y no se puede
	// alcanzar; por eso hay uno propio. Se activa por su nombre accesible.
	await page.getByRole("button", { name: "Remove tag música" }).press("Enter");

	await expect(
		page.getByRole("button", { name: "Remove tag música" }),
	).toBeHidden();
});

test("el listado con etiquetas y su filtro no tienen violaciones de accesibilidad", async ({
	page,
}) => {
	await signUp(page);
	await createTaggedEvent(page, "Concierto de verano", ["música"]);

	// Aquí sí la página entera: el listado con las `wa-tag` de la tarjeta y las
	// casillas del filtro, que es toda la superficie que T18 añade fuera del
	// diálogo.
	const resultados = await new AxeBuilder({ page }).analyze();
	expect(resultados.violations).toEqual([]);
});

test("el campo de etiquetas del editor no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await signUp(page);
	// Este test encontró una violación de verdad: las etiquetas del editor se
	// pintaban con el neutro por defecto de Web Awesome —4,42:1, por debajo de
	// AA— porque los colores por tono vivían sólo en la tarjeta. De ahí que el
	// estilo esté ahora compartido en `tag-styles.ts`.
	//
	// Se abre el editor **una sola vez** y se escanea sin guardar. Reabrirlo
	// destapa un defecto distinto que ya existe en `main`: en la segunda
	// apertura el diálogo se queda translúcido y axe mide contrastes de entre
	// 1,3:1 y 4,4:1 sobre su propio título y sobre la etiqueta de la portada.
	// Reproducido en `main` sin una línea de T18, y anotado como T43.
	await openEditor(page);
	await page.getByLabel("Title").fill("Concierto de verano");
	const campo = page.getByRole("textbox", { name: "Tags" });
	await campo.fill("música");
	await campo.press("Enter");
	await expect(
		page.getByRole("button", { name: "Remove tag música" }),
	).toBeVisible();

	// Acotado al campo de etiquetas, atravesando el shadow DOM. Escanear el
	// diálogo entero mide además su cromo —título y etiqueta de la portada—,
	// que arrastra un defecto de opacidad ya presente en `main` (ver T43) y
	// convertiría este test en un detector de aquél en vez de una prueba de
	// las etiquetas.
	//
	// Dos cosas que hay que acertar a la vez, y fallar cualquiera de ellas deja
	// un test verde que no mira nada:
	//
	// La cadena es de cuatro saltos y no de dos. Cada elemento entra en el
	// shadow root del anterior, y el editor vive dentro del de la vista, que
	// vive dentro del de la aplicación. Empezando en `planu-event-editor`, axe
	// aborta con «No elements found» — que es lo que pasó, y lo que dejó este
	// comentario describiendo un acotado que no estaba puesto.
	//
	// Y va **anidada**, `[[...]]`. Con el array plano axe no protesta: acota a
	// nada y devuelve cero violaciones sobre cero elementos. Medido — plano, 0
	// reglas aprobadas y 88 inaplicables; anidado, 21 aprobadas—. De ahí la
	// segunda aserción, que es lo único que separa «no hay violaciones» de «no
	// se ha mirado».
	const resultados = await new AxeBuilder({ page })
		.include([
			["planu-app", "planu-events-view", "planu-event-editor", ".tags"],
		])
		.analyze();
	expect(resultados.violations).toEqual([]);
	expect(resultados.passes.length).toBeGreaterThan(0);
});

test("una etiqueta seleccionada no desaparece al dejar de usarse", async ({
	page,
}) => {
	await signUp(page);
	await createTaggedEvent(page, "Concierto de verano", ["música"]);

	await page.locator('wa-checkbox[value="música"]').click();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();

	// Se edita el evento y se le quita la etiqueta, así que el vocabulario del
	// usuario se queda vacío y `availableTags` con él.
	await page.getByRole("button", { name: "Edit" }).click();
	await page.getByRole("button", { name: "Remove tag música" }).click();
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	// Pintando sólo `availableTags`, la casilla desaparecía del DOM con el
	// filtro todavía puesto: el listado se quedaba vacío para siempre y no había
	// nada marcado que lo explicase.
	await expect(page.getByRole("checkbox", { name: "música" })).toBeChecked();
	await expect(
		page.getByText("No events match your search, tags or date filter."),
	).toBeVisible();

	await page.getByRole("button", { name: "Clear filters" }).click();
	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
});

// --- Sugerencia de etiquetas con IA (T24) -----------------------------------
//
// El botón es explícito: guardar ya no toca la IA en ningún caso, con o sin
// etiquetas puestas, así que las únicas dos cosas que quedan por comprobar
// aquí son que el botón obedece a la disponibilidad y que pulsarlo no rompe
// nada cuando el intento real falla —que es lo único que puede pasar en este
// entorno, sin IA integrada de verdad—.

test("sin IA, no se ofrece el botón de sugerir y el alta funciona igual", async ({
	page,
}) => {
	// Un botón que siempre falla es peor que ningún botón: `unavailable`
	// —y no la ausencia de la API, que es un caso distinto ya cubierto en
	// ai.spec.ts— es el estado en el que no debe ofrecerse.
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "unavailable" },
			configurable: true,
		});
	});
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Cena sin etiquetas");

	await expect(
		page.getByRole("button", { name: "Suggest tags with AI" }),
	).toBeHidden();

	await page.getByRole("button", { name: "Save event" }).click();
	await expect(
		page.getByRole("heading", { name: "Cena sin etiquetas" }),
	).toBeVisible();
});

test("con la IA disponible, el botón aparece y un fallo real no bloquea nada", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, "LanguageModel", {
			value: { availability: async () => "available" },
			configurable: true,
		});
	});
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Cena de fin de curso con el equipo");

	const sugerir = page.getByRole("button", { name: "Suggest tags with AI" });
	await expect(sugerir).toBeVisible();
	await sugerir.click();

	// No hay IA integrada de verdad en este entorno: el intento real falla, se
	// traga en silencio —«si la IA no está disponible, silencio y ningún
	// error»—, y ni aparece ninguna etiqueta ni se muestra ningún aviso.
	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(sugerir).toBeEnabled();

	// Y el alta, sin ninguna etiqueta, sigue funcionando igual.
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(
		page.getByRole("heading", { name: "Cena de fin de curso con el equipo" }),
	).toBeVisible();
});

/**
 * Una fecha relativa a hoy, en el formato del `<input type="date">`.
 *
 * Relativa y no fija: desde T19 la vista separa próximos de pasados, así que
 * una fecha escrita a mano cambia de grupo con el paso del tiempo y el test
 * empieza a fallar solo un día cualquiera.
 */
function dayFromToday(offset: number): string {
	const date = new Date();
	date.setDate(date.getDate() + offset);
	return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

async function createTaggedDatedEvent(
	page: Page,
	title: string,
	offset: number,
	tag: string,
): Promise<void> {
	await openEditor(page);
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Start date").fill(dayFromToday(offset));
	await page.getByLabel("End date").fill(dayFromToday(offset));
	const campo = page.getByRole("textbox", { name: "Tags" });
	await campo.fill(tag);
	await campo.press("Enter");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
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

test("buscar abre el pliegue aunque haya resultados futuros también", async ({
	page,
}) => {
	// El escenario importa. Si la búsqueda sólo casara con pasados, el pliegue
	// se abriría **por otra regla** —son el único grupo con contenido— y el test
	// pasaría sin ejercitar la que aquí se prueba. Comprobado: con ese
	// escenario, romper la regla de «el usuario ha pedido algo» dejaba los 46
	// e2e en verde. Hacen falta las dos mitades con contenido.
	await signUp(page);
	await createDatedEvent(page, "Feria de abril", -30);
	await createDatedEvent(page, "Feria de otoño", 30);
	await createDatedEvent(page, "Congreso anual", 60);

	// Sin buscar: el futuro se ve, el pasado está plegado.
	await expect(
		page.getByRole("heading", { name: "Feria de otoño" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Feria de abril" }),
	).toBeHidden();

	await page.getByLabel("Search").fill("feria");

	// Las dos ferias casan, así que próximos **y** pasados tienen contenido: lo
	// único que puede abrir el pliegue es que el usuario haya pedido algo.
	await expect(
		page.getByRole("heading", { name: "Feria de otoño" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Feria de abril" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Congreso anual" }),
	).toBeHidden();
});

test("filtrar por etiqueta abre el pliegue igual que buscar", async ({
	page,
}) => {
	// Las dos son la misma intención. La vista las trataba distinto porque la
	// noción de «consulta explícita» estaba duplicada y una copia se olvidaba
	// de las etiquetas.
	await signUp(page);
	await createTaggedDatedEvent(page, "Feria de abril", -30, "feria");
	await createTaggedDatedEvent(page, "Feria de otoño", 30, "feria");
	await createDatedEvent(page, "Congreso anual", 60);

	await expect(
		page.getByRole("heading", { name: "Feria de abril" }),
	).toBeHidden();

	await page.locator('wa-checkbox[value="feria"]').click();

	await expect(
		page.getByRole("heading", { name: "Feria de abril" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Feria de otoño" }),
	).toBeVisible();
});

// --- T33 · Onboarding y primera sesión --------------------------------------
//
// El estado vacío deja de ser una frase suelta: explica qué hacer y ofrece
// las mismas tres vías de alta que ya existían en el menú "New event" —a
// mano, con IA— más un evento de ejemplo, discreto y que nunca se guarda
// solo. Nada de tour modal.

test("un usuario recién registrado crea su primer evento sin salir del estado vacío", async ({
	page,
}) => {
	await signUp(page);

	await expect(page.getByText("You have no events yet.")).toBeVisible();

	// El botón directo del estado vacío, no el menú "New event" de la barra.
	await page.getByRole("button", { name: "Create your first event" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();

	await page.getByLabel("Title").fill("Concierto de verano");
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();

	await expect(
		page.getByRole("heading", { name: "Concierto de verano" }),
	).toBeVisible();
	await expect(page.getByText("You have no events yet.")).toBeHidden();
});

test("probar un evento de ejemplo prerrellena el editor, pero no lo guarda por su cuenta", async ({
	page,
}) => {
	await signUp(page);

	await page
		.getByRole("button", { name: "Try a sample event instead" })
		.click();

	// El aviso deja claro que es un ejemplo, no algo que trajo la IA.
	await expect(page.getByText("This is a sample event.")).toBeVisible();
	await expect(page.getByLabel("Title")).toHaveValue("Dinner with friends");

	// Cerrarlo sin guardar no crea nada: la invitación es discreta y no actúa
	// por su cuenta.
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByText("You have no events yet.")).toBeVisible();
	await expect(page.locator("planu-event-card")).toHaveCount(0);

	// Pedirlo otra vez y esta vez revisarlo y guardarlo sí lo crea, como
	// cualquier alta manual.
	await page
		.getByRole("button", { name: "Try a sample event instead" })
		.click();
	await page.getByLabel("Title").fill("Cena con Ana");
	await page.getByRole("button", { name: "Save event" }).click();

	await expect(
		page.getByRole("heading", { name: "Cena con Ana" }),
	).toBeVisible();
});

test("cerrar un ejemplo sin guardar y crear a mano no arrastra sus datos", async ({
	page,
}) => {
	// El editor es una única instancia que se reutiliza: sin limpiar el
	// borrador al pedir un alta manual, este título de ejemplo se habría
	// quedado puesto.
	await signUp(page);

	await page
		.getByRole("button", { name: "Try a sample event instead" })
		.click();
	await expect(page.getByLabel("Title")).toHaveValue("Dinner with friends");
	await page.getByRole("button", { name: "Cancel" }).click();

	await page.getByRole("button", { name: "Create your first event" }).click();

	await expect(page.getByLabel("Title")).toHaveValue("");
	await expect(page.getByText("This is a sample event.")).toBeHidden();
});

test("el estado vacío no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await signUp(page);

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

// --- Date and time (T44–T48) -------------------------------------------------

test("crear un evento con hora, reabrirlo y ver la hora puesta", async ({
	page,
}) => {
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Cena de fin de curso");
	await page.getByLabel("Start date").fill("2026-07-04");
	await page.getByLabel("Start time").fill("19:30");
	await page.getByLabel("End date").fill("2026-07-04");
	await page.getByLabel("End time").fill("23:00");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	// The card already says the hour, without repeating the date since it falls on the same day.
	await expect(page.getByText("Jul 4, 2026, 7:30 PM – 11:00 PM")).toBeVisible();

	await page.getByRole("button", { name: "Edit" }).click();
	await expect(page.getByLabel("Start time")).toHaveValue("19:30");
	await expect(page.getByLabel("End time")).toHaveValue("23:00");
});

test("crear un evento sin hora no muestra ninguna al reabrirlo", async ({
	page,
}) => {
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Vacaciones");
	await page.getByLabel("Start date").fill("2026-08-01");
	await page.getByLabel("End date").fill("2026-08-15");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	// No hour on the card, all-day.
	await expect(page.getByText("Aug 1, 2026 – Aug 15, 2026")).toBeVisible();

	await page.getByRole("button", { name: "Edit" }).click();
	await expect(page.getByLabel("Start time")).toHaveValue("");
	await expect(page.getByLabel("End time")).toHaveValue("");
});

const FIRESTORE_EMULATOR =
	"http://127.0.0.1:8181/v1/projects/planu-app/databases/planu/documents";

interface EmulatorDocument {
	name: string;
	fields: Record<string, unknown>;
}

/**
 * Rewrites a just-created event's document to drop its `allDay` field
 * entirely, simulating a document written before this feature existed —
 * the implicit-migration case, which is neither "with an hour" nor
 * "without one": it never had the field at all.
 *
 * A PATCH with no `updateMask.fieldPaths` replaces the whole document with
 * exactly the fields given, so taking the real document's own fields and
 * deleting `allDay` from the copy reproduces a legacy document precisely —
 * same owner, same dates, same everything else — rather than hand-building
 * one that might drift from what `isValidEvent()` actually requires.
 */
async function stripAllDay(page: Page, title: string): Promise<void> {
	const admin = { Authorization: "Bearer owner" };
	const response = await page.request.post(`${FIRESTORE_EMULATOR}:runQuery`, {
		headers: admin,
		data: {
			structuredQuery: {
				from: [{ collectionId: "events" }],
				where: {
					fieldFilter: {
						field: { fieldPath: "title" },
						op: "EQUAL",
						value: { stringValue: title },
					},
				},
			},
		},
	});
	const rows = (await response.json()) as { document?: EmulatorDocument }[];
	const event = rows.map((row) => row.document).find(Boolean);
	if (!event) throw new Error(`event ${title} not found`);

	const { allDay: _allDay, ...rest } = event.fields;
	const path = event.name.split("/documents/")[1];
	const patched = await page.request.patch(`${FIRESTORE_EMULATOR}/${path}`, {
		headers: admin,
		data: { fields: rest },
	});
	expect(patched.ok()).toBe(true);
}

test("un evento heredado sin el campo allDay se muestra como día completo", async ({
	page,
}) => {
	// The implicit-migration case from T44's decision: default(true) fills
	// the gap for a document that predates the field. It's the read side of
	// that promise, checked against the real UI instead of the schema in
	// isolation — this is exactly where the equivalent bug slipped past
	// every unit test, one layer at a time (see T54's commit message).
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Evento heredado");
	await page.getByLabel("Start date").fill("2026-09-01");
	await page.getByLabel("End date").fill("2026-09-03");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	await stripAllDay(page, "Evento heredado");
	await page.reload();

	// All-day, no hour — same as if allDay had been saved true explicitly.
	await expect(page.getByText("Sep 1, 2026 – Sep 3, 2026")).toBeVisible();
});

test("borrar las dos horas devuelve el evento a día completo", async ({
	page,
}) => {
	await signUp(page);
	await openEditor(page);
	await page.getByLabel("Title").fill("Cena");
	await page.getByLabel("Start date").fill("2026-07-04");
	await page.getByLabel("Start time").fill("19:30");
	await page.getByLabel("End date").fill("2026-07-04");
	await page.getByLabel("End time").fill("23:00");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	await page.getByRole("button", { name: "Edit" }).click();
	await page.getByLabel("Start time").fill("");
	await page.getByLabel("End time").fill("");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();

	// Now it says only the date, with no hour.
	await expect(page.getByText("Jul 4, 2026 – Jul 4, 2026")).toBeVisible();

	await page.getByRole("button", { name: "Edit" }).click();
	await expect(page.getByLabel("Start time")).toHaveValue("");
	await expect(page.getByLabel("End time")).toHaveValue("");
});
