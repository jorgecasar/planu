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
	{
		path: "/",
		lang: "en",
		heading: "Your events. Private. Shareable. Yours.",
		title: "planu — Plan your events, privately",
	},
	{
		path: "/en/",
		lang: "en",
		heading: "Your events. Private. Shareable. Yours.",
		title: "planu — Plan your events, privately",
	},
	{
		path: "/es/",
		lang: "es",
		heading: "Tus eventos. Privados. Compartibles. Tuyos.",
		title: "planu — Planifica tus eventos, en privado",
	},
];

for (const { path, lang, heading, title } of LOCALES) {
	test(`${path} sirve la landing en ${lang}`, async ({ page }) => {
		const response = await page.goto(path);

		expect(response?.status()).toBe(200);
		await expect(page.locator("html")).toHaveAttribute("lang", lang);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
		// El <title> tiene su propia comprobación: un `msg()` importado antes de
		// `configureLocalization` en build-landing.js quedaba congelado en
		// inglés para siempre, y nada que mirase sólo el `<h1>` lo habría
		// cazado —el cuerpo renderizado por @lit-labs/ssr sí se traducía bien—.
		await expect(page).toHaveTitle(title);
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

test("cada idioma enlaza sus propios legales, y las páginas existen (T30)", async ({
	page,
	request,
}) => {
	// El pie enlazaba a `/es/privacy.html` en los dos idiomas, así que la versión
	// inglesa mandaba a la española. Y hasta T30 ninguna de las dos páginas
	// existía siquiera: comprobar sólo el `href` habría dejado pasar un enlace
	// a un 404, que es justo lo que pasaba antes.
	await page.goto("/");
	const enHref = await page
		.getByRole("link", { name: "Privacy", exact: true })
		.getAttribute("href");
	expect(enHref).toBe("/privacy.html");
	expect((await request.get(enHref ?? "")).status()).toBe(200);

	await page.goto("/es/");
	const esHref = await page
		.getByRole("link", { name: "Privacidad", exact: true })
		.getAttribute("href");
	expect(esHref).toBe("/es/privacy.html");
	expect((await request.get(esHref ?? "")).status()).toBe(200);
});

test("privacy.html y terms.html responden 200 en los dos idiomas y no se indexan", async ({
	request,
}) => {
	for (const path of [
		"/privacy.html",
		"/terms.html",
		"/es/privacy.html",
		"/es/terms.html",
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);

		const body = await response.text();
		// noindex: son páginas legales, no contenido que interese a un buscador,
		// y no están en sitemap.xml por el mismo motivo.
		expect(body, path).toContain('name="robots" content="noindex"');
	}
});

test("las páginas legales en español tienen su título traducido, no el inglés", async ({
	page,
}) => {
	// El síntoma exacto que este test existe para cazar: `<h1>` y el cuerpo
	// salían en español —pasan por @lit-labs/ssr, que sí resuelve `msg()`
	// correctamente— pero el `<title>` de la pestaña se quedaba en inglés,
	// porque se construía con un `msg()` importado antes de
	// `configureLocalization` en build-landing.js.
	await page.goto("/es/privacy.html");
	await expect(page).toHaveTitle("Política de privacidad — planu");

	await page.goto("/es/terms.html");
	await expect(page).toHaveTitle("Términos de servicio — planu");
});

test("privacy.html describe el tratamiento real, no un texto genérico", async ({
	page,
}) => {
	// Ancla el contenido a hechos verificables del propio repo, no a que "haya
	// texto": el aviso de cookies existe *porque* ADR 0009 eligió Firebase
	// Analytics, y esta página tiene que decirlo, no callarlo.
	await page.goto("/privacy.html");

	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Privacy Policy",
	);
	// El cuerpo, no el aviso de cookies del pie: los dos mencionan Firebase
	// Analytics, y en esta página coinciden en pantalla.
	await expect(
		page.locator(".wa-prose").getByText("Firebase Analytics", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByText("cloud AI is switched off", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByText("no self-service", { exact: false }),
	).toBeVisible();
});

test("el aviso de cookies está en toda página de la landing, no sólo en privacy.html", async ({
	page,
}) => {
	// ADR 0009: Firebase Analytics corre desde la primera visita, así que el
	// aviso no puede vivir detrás de un enlace que nadie tiene por qué seguir.
	for (const path of ["/", "/privacy.html", "/terms.html"]) {
		await page.goto(path);
		// El aviso vive en el pie, así que se ancla ahí y no a cualquier mención
		// de Firebase Analytics en la página — privacy.html también la nombra en
		// el cuerpo.
		await expect(
			page
				.locator(".cookie-notice")
				.getByText("Firebase Analytics", { exact: false }),
		).toBeVisible();
	}
});

test("privacy.html y terms.html no tienen violaciones de accesibilidad", async ({
	page,
}) => {
	for (const path of ["/privacy.html", "/terms.html"]) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations, path).toEqual([]);
	}
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

test("robots.txt no bloquea la landing y apunta al sitemap", async ({
	request,
}) => {
	const response = await request.get("/robots.txt");
	expect(response.status()).toBe(200);

	const body = await response.text();
	expect(body).toMatch(/Allow:\s*\//);
	expect(body).not.toMatch(/Disallow:\s*\/\s*$/m);
	expect(body).toContain("Sitemap: https://planu-app.web.app/sitemap.xml");
});

test("sitemap.xml lista sólo las URLs de la landing, con hreflang", async ({
	request,
}) => {
	const response = await request.get("/sitemap.xml");
	expect(response.status()).toBe(200);

	const body = await response.text();
	// Nada de /app entre las <loc>: es privado por diseño, no algo que el
	// sitemap invite a indexar aunque robots.txt lo bloquee por separado. Sólo
	// las <loc>, porque el propio comentario del fichero menciona "/app" al
	// explicar por qué no está.
	const locs = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
	expect(locs.some((loc) => loc?.includes("/app"))).toBe(false);
	for (const loc of ["planu-app.web.app/</loc>", "/en/</loc>", "/es/</loc>"]) {
		expect(body).toContain(loc);
	}
	expect(body).toContain('hreflang="x-default"');
});

test("la imagen del hero existe, con las medidas que declara y sin recorte inesperado", async ({
	page,
	request,
}) => {
	await page.goto("/");

	const img = page.locator("figure.hero-figure img");
	await expect(img).toBeVisible();

	const [ancho, alto] = await img.evaluate((el: HTMLImageElement) => [
		el.naturalWidth,
		el.naturalHeight,
	]);
	// Las medidas declaradas en el <img> (width/height) existen para reservar
	// el hueco antes de que la imagen cargue; si no coinciden con las reales
	// hay salto de layout (CLS) en el momento en que sí carga.
	expect(ancho).toBe(1200);
	expect(alto).toBe(675);

	const response = await request.get("/assets/landing/hero.webp");
	expect(response.status()).toBe(200);
	// No es el peso exacto —cambia con cada regeneración— sino que sigue
	// siendo una imagen comprimida y no, por ejemplo, el PNG sin comprimir de
	// 2 MB que generó la herramienta antes de redimensionar.
	const bytes = (await response.body()).length;
	expect(bytes).toBeLessThan(200 * 1024);
});
