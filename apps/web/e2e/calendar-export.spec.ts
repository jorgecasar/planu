import { readFile } from "node:fs/promises";
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

async function createEvent(
	page: Page,
	title: string,
	dates?: {
		start: string;
		end?: string;
		startTime?: string;
		endTime?: string;
	},
): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await expect(page.getByLabel("Title")).toBeVisible();

	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Description").fill(`About ${title}`);
	await page.getByLabel("Location").fill("Madrid");
	if (dates) {
		await page.getByLabel("Start date").fill(dates.start);
		if (dates.startTime)
			await page.getByLabel("Start time").fill(dates.startTime);
		if (dates.end) await page.getByLabel("End date").fill(dates.end);
		if (dates.endTime) await page.getByLabel("End time").fill(dates.endTime);
	}
	await page.getByRole("button", { name: "Save event" }).click();

	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	// El diálogo es modal: hasta que termina su animación de cierre el resto de
	// la página sigue inerte y cualquier interacción se pierde.
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

/** Pulsa una opción del menú de exportación y devuelve el fichero descargado. */
async function exportar(
	page: Page,
	trigger: "Add to calendar" | "Export calendar",
): Promise<{ nombre: string; contenido: string }> {
	const descarga = page.waitForEvent("download");
	await page.getByRole("button", { name: trigger }).first().click();
	await page.getByRole("menuitem", { name: "Download .ics file" }).click();

	const download = await descarga;
	const ruta = await download.path();
	return {
		nombre: download.suggestedFilename(),
		contenido: await readFile(ruta, "utf8"),
	};
}

test("un evento con fechas se descarga como .ics", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano", {
		start: "2026-06-12",
		end: "2026-06-14",
	});

	const { nombre, contenido } = await exportar(page, "Add to calendar");

	expect(nombre).toBe("concierto-de-verano.ics");
	expect(contenido.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
	expect(contenido).toContain("BEGIN:VEVENT");
	expect(contenido).toContain("SUMMARY:Concierto de verano");
	expect(contenido).toContain("DTSTART;VALUE=DATE:20260612");
	// Fin exclusivo: el 15 y no el 14.
	expect(contenido).toContain("DTEND;VALUE=DATE:20260615");
	expect(contenido).toContain("END:VCALENDAR");
	// Ninguna línea pasa de 75 octetos, que es lo que hace válido el fichero.
	for (const linea of contenido.split("\r\n")) {
		expect(Buffer.byteLength(linea, "utf8")).toBeLessThanOrEqual(75);
	}
});

test("el .ics de la agenda respeta los filtros activos", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano", { start: "2026-06-12" });
	await createEvent(page, "Cena de empresa", { start: "2026-07-01" });

	await page.getByLabel("Search").fill("concierto");
	await expect(
		page.getByRole("heading", { name: "Cena de empresa" }),
	).toBeHidden();

	const { nombre, contenido } = await exportar(page, "Export calendar");

	expect(nombre).toBe("planu-agenda.ics");
	expect(contenido.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	expect(contenido).toContain("SUMMARY:Concierto de verano");
	expect(contenido).not.toContain("Cena de empresa");
});

test("un evento sin fechas avisa y no descarga nada", async ({ page }) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	let descargas = 0;
	page.on("download", () => {
		descargas += 1;
	});

	await page.getByRole("button", { name: "Add to calendar" }).first().click();
	await page.getByRole("menuitem", { name: "Download .ics file" }).click();

	await expect(page.getByRole("alert")).toContainText("no dates");
	expect(descargas).toBe(0);
});

test("el aviso de exportación no tiene violaciones de accesibilidad", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Concierto de verano");

	await page.getByRole("button", { name: "Add to calendar" }).first().click();
	await page.getByRole("menuitem", { name: "Download .ics file" }).click();
	await expect(page.getByRole("alert")).toBeVisible();

	// El desplegable se va con una animación, y axe mide colores a medio fundir
	// si se le adelanta: el ítem del menú daba 1,25:1 sobre fondo casi blanco.
	// No es una violación, es una foto movida. Se espera a que el menú deje de
	// estar en el árbol antes de mirar.
	await expect(
		page.getByRole("menuitem", { name: "Download .ics file" }),
	).toBeHidden();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

// --- Hour in the export (T46, T54) -------------------------------------------

/**
 * `YYYYMMDDTHHMMSSZ` of a local date, computed with the same UTC getters
 * `toIcsDateTime` uses. No timezone offset is hardcoded: the runner can
 * execute in any timezone.
 */
function icsDateTime(local: Date): string {
	const pad = (value: number, length = 2) =>
		String(value).padStart(length, "0");
	return (
		`${pad(local.getUTCFullYear(), 4)}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}` +
		`T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}Z`
	);
}

test("un evento con hora exporta DTSTART con hora, no VALUE=DATE", async ({
	page,
}) => {
	await signUp(page);
	await createEvent(page, "Cena de fin de curso", {
		start: "2026-06-12",
		startTime: "19:30",
		end: "2026-06-12",
		endTime: "23:00",
	});

	const { contenido } = await exportar(page, "Add to calendar");

	expect(contenido).toContain(
		`DTSTART:${icsDateTime(new Date(2026, 5, 12, 19, 30))}`,
	);
	expect(contenido).toContain(
		`DTEND:${icsDateTime(new Date(2026, 5, 12, 23, 0))}`,
	);
	expect(contenido).not.toContain("VALUE=DATE");
});

test("un evento de día completo sigue exportando VALUE=DATE", async ({
	page,
}) => {
	// The contrast with the previous test: with no hour, T44–T46's acceptance
	// criterion still holds with no regression.
	await signUp(page);
	await createEvent(page, "Vacaciones", {
		start: "2026-08-01",
		end: "2026-08-15",
	});

	const { contenido } = await exportar(page, "Add to calendar");

	expect(contenido).toContain("DTSTART;VALUE=DATE:20260801");
	expect(contenido).toContain("DTEND;VALUE=DATE:20260816");
});

test("un evento a las 00:00 con hora explícita exporta DTSTART con hora, no VALUE=DATE", async ({
	page,
}) => {
	// The spec's own flagship example (decision 1): the exact case
	// `isStartOfDay()` used to get wrong, by guessing "allDay" from the date
	// landing on local midnight instead of reading an explicit flag. Typing
	// "00:00" produces the same Date as leaving the field empty — the only
	// thing that tells them apart is allDay, which this test pins to false
	// by filling the time field instead of leaving it blank.
	await signUp(page);
	await createEvent(page, "Entrega a medianoche", {
		start: "2026-06-20",
		startTime: "00:00",
	});

	const { contenido } = await exportar(page, "Add to calendar");

	expect(contenido).toContain(
		`DTSTART:${icsDateTime(new Date(2026, 5, 20, 0, 0))}`,
	);
	expect(contenido).not.toContain("VALUE=DATE");
});
