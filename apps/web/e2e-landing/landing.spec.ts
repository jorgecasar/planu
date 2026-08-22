import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Tests de la landing **prerrenderizada**, contra `dist/` y no contra
 * `npm run dev`: en desarrollo esta página no existe.
 *
 * Cierran lo que T26 llamaba «contraste verificado, no supuesto» —la tabla de
 * `theme.css` era un cálculo sobre los valores— y lo que T27 pedía de axe.
 */

const LOCALES = [
	{ path: "/", lang: "en", heading: "Your events. Private. Shareable. Yours." },
	{
		path: "/en/",
		lang: "en",
		heading: "Your events. Private. Shareable. Yours.",
	},
	{
		path: "/es/",
		lang: "es",
		heading: "Tus eventos. Privados. Compartibles. Tuyos.",
	},
];

for (const { path, lang, heading } of LOCALES) {
	test(`${path} sirve la landing en ${lang}`, async ({ page }) => {
		const response = await page.goto(path);

		expect(response?.status()).toBe(200);
		await expect(page.locator("html")).toHaveAttribute("lang", lang);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
	});

	test(`${path} no tiene violaciones de accesibilidad`, async ({ page }) => {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		// Sin `withTags`: interesa todo lo que axe sepa ver, contraste incluido.
		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations).toEqual([]);
	});
}

test("la raíz es la landing, no la aplicación", async ({ page }) => {
	// La redirección de `/` a `/app` se quitó de `firebase.json`. Si volviera,
	// este test es lo que lo dice: la landing dejaría de ser la portada.
	await page.goto("/");

	await expect(page).toHaveURL(/\/$/);
	await expect(
		page.getByRole("link", { name: "Start planning" }),
	).toBeVisible();
});

test("la landing no carga JavaScript", async ({ page }) => {
	// El único `<script>` permitido es el JSON-LD. Un bundle aquí rompería el
	// LCP que la página existe para proteger, y T29 lo prohíbe.
	await page.goto("/");

	const types = await page
		.locator("script")
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("type")));
	expect(types).toEqual(["application/ld+json"]);
});

test("la landing se ve con JavaScript desactivado", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto("/");

	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Start planning" }),
	).toBeVisible();
	// Los seis iconos son SVG en línea, no `<wa-icon>`: un custom element no se
	// definiría nunca aquí y las tarjetas saldrían sin icono.
	await expect(page.locator("svg.feature-icon")).toHaveCount(6);

	await context.close();
});

test("cada idioma enlaza sus propios legales", async ({ page }) => {
	// El pie enlazaba a `/es/privacy.html` en los dos idiomas, así que la versión
	// inglesa mandaba a la española.
	await page.goto("/");
	await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute(
		"href",
		"/privacy.html",
	);

	await page.goto("/es/");
	await expect(page.getByRole("link", { name: "Privacidad" })).toHaveAttribute(
		"href",
		"/es/privacy.html",
	);
});

test("el hreflang apunta a URLs que existen", async ({ page, request }) => {
	await page.goto("/");

	const hrefs = await page
		.locator("link[rel=alternate][hreflang]")
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
	expect(hrefs.length).toBeGreaterThan(0);

	for (const href of hrefs) {
		// Se comprueba la ruta contra este servidor, no el dominio de producción.
		const path = new URL(href ?? "").pathname;
		const response = await request.get(path);
		expect(response.status(), `${href} → ${path}`).toBe(200);
	}
});

test("el doctype es el primer nodo del documento", async ({ page }) => {
	// `@lit-labs/ssr` colaba un `<!--lit-part-->` delante, y un documento cuyo
	// primer nodo no es el doctype se pinta en quirks mode.
	await page.goto("/");

	const mode = await page.evaluate(() => document.compatMode);
	expect(mode).toBe("CSS1Compat");
});

test("las clases del marcado tienen estilos detrás", async ({ page }) => {
	// Esto es lo que faltaba, y por eso se publicó una landing sin estilos: los
	// demás tests miran el DOM —encabezados, landmarks, hreflang— y axe no se
	// queja de una página sin CSS, porque el HTML semántico es accesible igual.
	// Nadie comprobaba la presentación.
	//
	// Dos fallos distintos se colaron así: faltaba la hoja de Web Awesome
	// entera, y nueve clases (`wa-text-3xl`, `wa-button--brand`…) estaban
	// inventadas con la convención de otro framework.
	await page.goto("/");

	// Toda clase `wa-*` del marcado debe casar con alguna regla del CSS cargado.
	// Se pregunta al navegador, no al fichero: es la única forma de incluir lo
	// que llega por `<link>` y lo que va en línea.
	const huerfanas = await page.evaluate(() => {
		const usadas = new Set<string>();
		for (const el of document.querySelectorAll("[class]")) {
			for (const c of el.classList) {
				if (c.startsWith("wa-")) usadas.add(c);
			}
		}

		let reglas = "";
		for (const hoja of Array.from(document.styleSheets)) {
			try {
				for (const regla of Array.from(hoja.cssRules)) reglas += regla.cssText;
			} catch {
				// Una hoja de otro origen no se puede leer; aquí no hay ninguna.
			}
		}

		// Las utilidades de layout se declaran como `[class*='wa-stack']`, no como
		// `.wa-stack`, así que basta con que el nombre aparezca en alguna regla.
		return [...usadas].filter((c) => !reglas.includes(c)).sort();
	});

	expect(huerfanas).toEqual([]);
});

test("el hero se pinta con la tipografía y el color de la marca", async ({
	page,
}) => {
	// Una comprobación de verdad sobre píxeles: si la hoja no cargara, el h1
	// saldría con la fuente y el tamaño por defecto del navegador.
	await page.goto("/");

	const h1 = page.getByRole("heading", { level: 1 });
	const estilo = await h1.evaluate((el) => {
		const c = getComputedStyle(el);
		return { fontFamily: c.fontFamily, fontSize: c.fontSize };
	});

	expect(estilo.fontFamily).toContain("Belleza");
	// El tamaño por defecto de un h1 es 32px; el token `3xl` es mayor.
	expect(Number.parseFloat(estilo.fontSize)).toBeGreaterThan(32);
});

test("los botones de llamada a la acción se pintan como botones", async ({
	page,
}) => {
	// `a.wa-button` lo estiliza `native.css`, y las variantes las define
	// `landing.css` porque `<wa-button>` es un componente y aquí no hay JS.
	await page.goto("/");

	const cta = page.getByRole("link", { name: "Start planning" });
	const estilo = await cta.evaluate((el) => {
		const c = getComputedStyle(el);
		return {
			display: c.display,
			background: c.backgroundColor,
			decoration: c.textDecorationLine,
		};
	});

	expect(estilo.display).toBe("flex");
	expect(estilo.decoration).toBe("none");
	// Indigo de la marca, no el fondo transparente de un enlace suelto.
	expect(estilo.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("las tarjetas se reparten en rejilla, no en una columna", async ({
	page,
}) => {
	// Si `wa-grid` no tuviera estilos, los seis artículos quedarían apilados y
	// todos compartirían el mismo `x`.
	await page.goto("/");

	const xs = await page
		.locator(".feature-card")
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));

	expect(xs.length).toBe(6);
	expect(new Set(xs).size).toBeGreaterThan(1);
});
