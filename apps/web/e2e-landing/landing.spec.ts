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
		heading: "Plan your events. Share them only with the people you choose.",
		title: "planu — Plan your events, privately",
	},
	{
		path: "/en/",
		lang: "en",
		heading: "Plan your events. Share them only with the people you choose.",
		title: "planu — Plan your events, privately",
	},
	{
		path: "/es/",
		lang: "es",
		heading: "Planifica tus eventos. Compártelos solo con quien tú elijas.",
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
		page.getByRole("link", { name: "Create your account" }),
	).toBeVisible();
});

const SHARING_COPY = [
	{
		path: "/en/",
		old: "They get access instantly",
		current:
			"Invite someone by email and decide whether they only look or can edit too. They need a planu account and accept the invitation, and you can take their access away whenever you like.",
	},
	{
		path: "/es/",
		old: "acceso al instante",
		current:
			"Invita por correo y decide si cada persona solo mira o también puede editar. Necesita una cuenta de planu y acepta la invitación, y puedes quitarle el acceso cuando quieras.",
	},
];

for (const { path, old, current } of SHARING_COPY) {
	test(`${path} no promete invitaciones que la app no cumple`, async ({
		page,
	}) => {
		// The old copy promised instant access and signup links; invitations are
		// accepted, and nothing is sent by email (ADR 0012).
		await page.goto(path);
		await expect(page.getByText(current)).toHaveCount(1);
		await expect(page.getByText(old)).toHaveCount(0);
		await expect(page.getByText("signup link")).toHaveCount(0);
		await expect(page.getByText("© 2026 planu")).toHaveCount(1);
	});
}

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
		page.getByRole("link", { name: "Create your account" }),
	).toBeVisible();
	// Los cuatro iconos son SVG en línea, no `<wa-icon>`: un custom element no se
	// definiría nunca aquí y las tarjetas saldrían sin icono.
	await expect(page.locator("svg.feature-icon")).toHaveCount(4);

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
	const paginas = [
		"/",
		"/privacy.html",
		"/terms.html",
		"/en/",
		"/en/privacy.html",
		"/en/terms.html",
		"/es/",
		"/es/privacy.html",
		"/es/terms.html",
	];

	// Toda clase `wa-*` del marcado debe casar con alguna regla de la hoja de
	// Web Awesome, la que llega por `<link>`. Sólo ésa: con el CSS en línea
	// contando, `landing.css` podía definir `wa-text-3xl` y el test lo daba
	// por bueno, que es justo la clase inventada que venía a impedir.
	for (const ruta of paginas) {
		const respuesta = await page.goto(ruta);
		expect(respuesta?.ok(), ruta).toBe(true);

		const huerfanas = await page.evaluate(() => {
			const usadas = new Set<string>();
			for (const el of document.querySelectorAll("[class]")) {
				for (const c of el.classList) {
					if (c.startsWith("wa-")) usadas.add(c);
				}
			}

			let reglas = "";
			for (const hoja of Array.from(document.styleSheets)) {
				if (!hoja.href?.includes("/assets/webawesome-")) continue;
				try {
					for (const regla of Array.from(hoja.cssRules))
						reglas += regla.cssText;
				} catch {
					// Una hoja de otro origen no se puede leer; aquí no hay ninguna.
				}
			}

			// Las utilidades de layout se declaran como `[class*='wa-stack']`, no
			// como `.wa-stack`, y basta con que el nombre aparezca en esa forma. El
			// resto exige el selector `.clase` exacto: una inventada que sea
			// prefijo de una real (`wa-size` frente a `wa-size-l`) no casa.
			const existe = (c: string) =>
				new RegExp(`\\.${c}(?![\\w-])`).test(reglas) ||
				reglas.includes(`[class*="${c}"]`) ||
				reglas.includes(`[class*='${c}']`);
			return [...usadas].filter((c) => !existe(c)).sort();
		});

		expect(huerfanas, ruta).toEqual([]);
	}
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

test("cada familia se descarga una sola vez y los encabezados no van en falsa negrita", async ({
	page,
}) => {
	const fuentes: string[] = [];
	page.on("response", (r) => {
		if (r.url().endsWith(".woff2"))
			fuentes.push(r.url().split("/").pop() ?? "");
	});
	await page.goto("/en/");
	await page.evaluate(() => document.fonts.ready);

	expect(fuentes.filter((f) => f.startsWith("belleza"))).toEqual([
		"belleza-latin-400.woff2",
	]);
	expect(fuentes.filter((f) => f.startsWith("alegreya"))).toHaveLength(1);
	// Belleza only exists at 400: any other weight is painted as fake bold.
	const pesos = await page
		.locator("h1, h2, h3")
		.evaluateAll((els) => els.map((el) => getComputedStyle(el).fontWeight));
	expect(pesos.length).toBeGreaterThan(0);
	expect(new Set(pesos)).toEqual(new Set(["400"]));
});

test("los encabezados de las páginas legales tampoco van en falsa negrita", async ({
	page,
}) => {
	for (const ruta of ["/en/privacy.html", "/en/terms.html"]) {
		await page.goto(ruta);
		const pesos = await page
			.locator("h1, h2, h3")
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).fontWeight));
		expect(pesos.length).toBeGreaterThan(0);
		expect(new Set(pesos), ruta).toEqual(new Set(["400"]));
	}
});

test("los botones de llamada a la acción se pintan como botones", async ({
	page,
}) => {
	// `<wa-button>` es un componente y aquí no hay JS: `a.wa-button` lo
	// estiliza `native.css`, con `wa-brand`, `wa-outlined` y `wa-size-l`.
	await page.goto("/");

	const estilo = (name: string) =>
		page.getByRole("link", { name }).evaluate((el) => {
			const c = getComputedStyle(el);
			return {
				display: c.display,
				background: c.backgroundColor,
				border: c.borderTopColor,
				decoration: c.textDecorationLine,
				size: c.fontSize,
			};
		});
	const marca = await page.evaluate(() => {
		const probe = document.createElement("span");
		probe.style.color = "var(--wa-color-brand-fill-loud)";
		probe.style.borderColor = "var(--wa-color-brand-border-loud)";
		document.body.append(probe);
		const c = getComputedStyle(probe);
		return { fill: c.color, border: c.borderTopColor };
	});

	const primario = await estilo("Create your account");
	expect(primario.display).toBe("flex");
	expect(primario.decoration).toBe("none");
	// Indigo de la marca, no el fondo transparente de un enlace suelto.
	expect(primario.background).toBe(marca.fill);
	// `wa-size-l`: el tamaño grande.
	expect(Number.parseFloat(primario.size)).toBeGreaterThan(16);

	// «Sign in» is a plain text link (`wa-plain`): it must not look like a
	// second primary action.
	const secundario = await estilo("Sign in");
	expect(secundario.decoration).toBe("none");
	expect(secundario.background).toBe("rgba(0, 0, 0, 0)");
	expect(secundario.border).toBe("rgba(0, 0, 0, 0)");
	expect(secundario.background).not.toBe(marca.fill);
});

for (const { path, cta, signIn } of [
	{ path: "/en/", cta: "Create your account", signIn: "Sign in" },
	{ path: "/es/", cta: "Crea tu cuenta", signIn: "Entrar" },
]) {
	test(`${path} tiene una sola acción primaria y «${signIn}» no compite`, async ({
		page,
	}) => {
		await page.goto(path);

		const primarias = page.locator("a.wa-button.wa-brand");
		await expect(primarias).toHaveCount(1);
		await expect(primarias).toHaveText(cta);
		await expect(primarias).toHaveAttribute("href", "/app/login?mode=signup");

		const entrar = page.locator("header a.wa-button");
		await expect(entrar).toHaveText(signIn);
		await expect(entrar).toHaveAttribute("href", "/app/login");
		await expect(entrar).toHaveClass(/wa-plain/);
		await expect(entrar).not.toHaveClass(/wa-brand/);

		// D7: nothing in the repo backs «free» or «no ads».
		await expect(
			page.getByText(/\bfree\b|\bgratis\b|\bno ads\b|sin anuncios/i),
		).toHaveCount(0);
	});

	for (const [ancho, alto] of [
		[390, 844],
		[1280, 800],
	] as const) {
		test(`${path} muestra h1 y CTA en la primera pantalla a ${ancho}x${alto}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: ancho, height: alto });
			await page.goto(path);

			for (const locator of [
				page.getByRole("heading", { level: 1 }),
				page.locator("a.wa-button.wa-brand"),
			]) {
				const box = await locator.boundingBox();
				expect(box).not.toBeNull();
				expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(alto);
			}
		});
	}

	test(`${path} no hace scroll horizontal a 320 px`, async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await page.goto(path);

		const [ancho, visible] = await page.evaluate(() => [
			document.documentElement.scrollWidth,
			document.documentElement.clientWidth,
		]);
		expect(ancho).toBeLessThanOrEqual(visible);
	});
}

test("las tarjetas se reparten en rejilla, no en una columna", async ({
	page,
}) => {
	// Si `wa-grid` no tuviera estilos, los cuatro artículos quedarían apilados y
	// todos compartirían el mismo `x`.
	await page.goto("/");

	const xs = await page
		.locator(".feature-card")
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));

	expect(xs.length).toBe(4);
	expect(new Set(xs).size).toBeGreaterThan(1);
});

const BENEFITS = [
	{
		path: "/",
		h2: "What you can do with planu",
		h3s: [
			"Private until you say so",
			"Viewer or editor, you choose",
			"From a poster or a text to an event",
			"To your calendar",
		],
	},
	{
		path: "/es/",
		h2: "Qué puedes hacer con planu",
		h3s: [
			"Privado hasta que tú digas",
			"Lector o editor, tú eliges",
			"De un cartel o un texto al evento",
			"A tu calendario",
		],
	},
];

for (const { path, h2, h3s } of BENEFITS) {
	test(`${path} muestra cuatro beneficios, en orden y sin frases retiradas`, async ({
		page,
	}) => {
		await page.goto(path);

		// El h2 de la sección y, debajo, un h3 por tarjeta en el orden de la spec.
		const section = page.locator(".features");
		await expect(section.getByRole("heading", { level: 2 })).toHaveText(h2);
		await expect(section.getByRole("heading", { level: 3 })).toHaveText(h3s);

		// Frases que la spec retira: una promesa de velocidad, de "sin teclear" y
		// una lista de aplicaciones de calendario que la app no comprueba.
		const text = (await section.innerText()).toLowerCase();
		for (const banned of [
			"in seconds",
			"en segundos",
			"no typing",
			"no hace falta escribir",
			"apple calendar",
			"outlook",
			"free",
			"gratis",
			"ads",
			"anuncios",
		]) {
			expect(text).not.toMatch(new RegExp(`\\b${banned}\\b`));
		}
	});
}

const STEPS = [
	{
		path: "/",
		stepsH2: "How to start",
		steps: [
			"Create your account",
			"Add your first event",
			"Share it or take it with you",
		],
	},
	{
		path: "/es/",
		stepsH2: "Cómo empezar",
		steps: [
			"Crea tu cuenta",
			"Añade tu primer evento",
			"Compártelo o llévatelo contigo",
		],
	},
];

for (const { path, stepsH2, steps } of STEPS) {
	test(`${path} tiene «${stepsH2}» tras los beneficios, con tres pasos`, async ({
		page,
	}) => {
		await page.goto(path);

		// Orden de las secciones y de sus encabezados: h1 → h2 → h3.
		const classes = await page
			.locator("main > section")
			.evaluateAll((els) => els.map((el) => el.classList[0]));
		expect(classes).toEqual(["hero", "features", "steps", "rules"]);

		const stepsSection = page.locator(".steps");
		await expect(stepsSection.getByRole("heading", { level: 2 })).toHaveText(
			stepsH2,
		);
		await expect(stepsSection.getByRole("heading", { level: 3 })).toHaveText(
			steps,
		);
		await expect(stepsSection.locator("ol > li")).toHaveCount(3);

		// Nada que la spec retira ni que la app no cumpla: ni «gratis», ni
		// invitar a quien no tiene cuenta.
		const text = (await stepsSection.innerText()).toLowerCase();
		for (const banned of [
			"free",
			"gratis",
			"ads",
			"anuncios",
			"in seconds",
			"en segundos",
			"without an account",
			"sin cuenta",
			"registration link",
			"enlace de registro",
		]) {
			expect(text).not.toMatch(new RegExp(`\\b${banned}\\b`));
		}
	});
}

const RULES = [
	{
		path: "/",
		h2: "Your events, your rules",
		roles: ["You", "Editor", "Viewer"],
		editor: "Reads and edits the content. Can't invite or delete.",
		viewer: "Only reads.",
		note: "Anyone can leave an event that was shared with them, and you can delete your account whenever you want.",
	},
	{
		path: "/es/",
		h2: "Tus eventos, tus reglas",
		roles: ["Tú", "Editor", "Lector"],
		editor: "Lee y edita el contenido. No puede invitar ni borrar.",
		viewer: "Solo lee.",
		note: "Cualquiera puede salir de un evento que le hayan compartido, y tú puedes borrar tu cuenta cuando quieras.",
	},
];

for (const { path, h2, roles, editor, viewer, note } of RULES) {
	test(`${path} tiene «${h2}» con la tabla de roles en una lista de definiciones`, async ({
		page,
	}) => {
		await page.goto(path);

		const rules = page.locator(".rules");
		await expect(rules.getByRole("heading", { level: 2 })).toHaveText(h2);
		await expect(rules.locator("dl > div > dt")).toHaveText(roles);
		await expect(rules.locator("dl > div > dd")).toHaveCount(3);
		// El editor no invita ni borra, y su texto no promete subir imágenes:
		// storage.rules solo deja escribir al dueño. El lector solo lee.
		await expect(rules.locator("dd").nth(1)).toHaveText(editor);
		await expect(rules.locator("dd").nth(2)).toHaveText(viewer);
		await expect(rules.locator("p")).toHaveText(note);

		// Sin tarjetas y sin promesas que la app no cumple (#280).
		await expect(rules.locator(".feature-card")).toHaveCount(0);
		const text = (await rules.innerText()).toLowerCase();
		for (const banned of [
			"free",
			"gratis",
			"image",
			"imagen",
			"without an account",
			"sin cuenta",
		]) {
			expect(text).not.toMatch(new RegExp(`\\b${banned}\\b`));
		}
	});
}

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

for (const [path, lang] of [
	["/", "en"],
	["/es/", "es"],
] as const) {
	test(`las capturas de compartir y exportar (${lang}) existen, con sus medidas y bajo 60 KB`, async ({
		page,
		request,
	}) => {
		await page.goto(path);
		const shots = page.locator(".feature-card img.feature-shot");
		await expect(shots).toHaveCount(2);
		const expected = [
			[`/assets/landing/share-${lang}.webp`, 544, 600],
			[`/assets/landing/export-${lang}.webp`, 1200, 420],
		] as const;
		for (const [index, [src, width, height]] of expected.entries()) {
			const shot = shots.nth(index);
			await expect(shot).toHaveAttribute("src", src);
			await expect(shot).toHaveAttribute("width", String(width));
			await expect(shot).toHaveAttribute("height", String(height));
			// Debajo del pliegue: no compite con el LCP del hero.
			await expect(shot).toHaveAttribute("loading", "lazy");
			expect((await shot.getAttribute("alt"))?.length).toBeGreaterThan(20);
			const response = await request.get(src);
			expect(response.status()).toBe(200);
			expect((await response.body()).length).toBeLessThan(60 * 1024);
		}
	});
}
test("el hero en español usa la captura en español, de 1200×675 y bajo 60 KB", async ({
	page,
	request,
}) => {
	await page.goto("/es/");
	const img = page.locator("figure.hero-figure img");
	await expect(img).toHaveAttribute("src", "/assets/landing/hero-es.webp");
	await expect(img).toHaveAttribute("alt", /lista de eventos de planu/);
	const response = await request.get("/assets/landing/hero-es.webp");
	expect(response.status()).toBe(200);
	expect((await response.body()).length).toBeLessThan(60 * 1024);
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

	// La captura es la de este idioma, y se pide sin diferir: es el LCP.
	const src = await img.getAttribute("src");
	expect(src).toBe("/assets/landing/hero-en.webp");
	await expect(img).not.toHaveAttribute("loading", "lazy");
	const response = await request.get(src ?? "");
	expect(response.status()).toBe(200);
	// No es el peso exacto —cambia con cada regeneración— sino el tope de la
	// especificación: 60 KB por captura.
	const bytes = (await response.body()).length;
	expect(bytes).toBeLessThan(60 * 1024);
});
