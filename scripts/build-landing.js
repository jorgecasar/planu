#!/usr/bin/env node

/**
 * Prerrenderiza la landing a HTML estático, un fichero por idioma, con
 * `@lit-labs/ssr`. Lee `theme.css` y `landing.css`, los minifica y los mete en
 * línea en la plantilla; escribe `dist/index.html` para el idioma de origen y
 * `dist/localized/{locale}/index.html` para los demás.
 *
 * Corre con `npm run build:landing`, después de `vite build`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@lit-labs/ssr";
import { build as esbuild } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WEB = resolve(ROOT, "apps/web");
// Run CLIs' JS entries with this node: no shell, and no `.cmd` shim on Windows.
const requireFromWeb = createRequire(resolve(WEB, "package.json"));
const binOf = (pkg, bin) =>
	resolve(dirname(requireFromWeb.resolve(`${pkg}/package.json`)), bin);
const VITE_BIN = binOf("vite", "bin/vite.js");
const DIST = resolve(ROOT, "dist");
const APP_DIST = resolve(ROOT, "apps/web/dist");
const ASSETS_LANDING = resolve(ROOT, "apps/web/public/assets/landing");
const FONTS_SOURCE = resolve(ROOT, "apps/web/public/fonts");
const FONTS_DEST = resolve(DIST, "fonts");

/**
 * Tope de bytes del HTML de cada idioma, CSS en línea incluido.
 *
 * La landing no carga JavaScript, así que este fichero **es** la página: lo que
 * pese decide el LCP. El tope está por encima del tamaño actual con margen para
 * crecer, y por debajo del punto en que el CSS en línea deja de compensar el
 * viaje extra que ahorra. Si se pasa, el build para: la alternativa es
 * enterarse en Lighthouse tres despliegues después.
 */
const HTML_BUDGET_BYTES = 24 * 1024;

/**
 * Quita los marcadores de hidratación que emite `@lit-labs/ssr`.
 *
 * No son cosmética: el primero se cuela **antes** del `<!doctype html>`, y un
 * documento cuyo primer nodo no es el doctype se pinta en *quirks mode*. Como
 * la landing es estática y nadie la hidrata, los marcadores no sirven para
 * nada aquí.
 */
function stripLitMarkers(html) {
	return html
		.replace(/<!--\/?lit-part[^>]*-->/g, "")
		.replace(/<!--lit-node \d+-->/g, "")
		.trimStart();
}

/**
 * Rutas absolutas que los HTML generados piden y no existen en `dist/`.
 *
 * Sólo mira `src` y `href` de rutas locales: los `url()` del CSS en línea ya
 * pasan por el mismo directorio y las fuentes se copian aquí mismo.
 */
function missingAssets(htmlFiles) {
	const missing = new Set();
	for (const file of htmlFiles) {
		const html = readFileSync(file, "utf-8");
		for (const [, ref] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
			// Las rutas de navegación no son ficheros; sólo comprobamos assets.
			if (!/\.[a-z0-9]{2,5}$/i.test(ref)) continue;
			if (!existsSync(resolve(DIST, ref.slice(1)))) missing.add(ref);
		}
	}
	return [...missing];
}

function minifyCss(css) {
	// Minificado suficiente para CSS propio: fuera comentarios y espacios.
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ")
		.replace(/\s*([{}:;,>+~])\s*/g, "$1")
		.trim();
}

async function buildLanding() {
	console.log("🏗️  Building landing page...");

	// Clean dist directory
	if (existsSync(DIST)) {
		rmSync(DIST, { recursive: true, force: true });
	}

	// Build the web app first (vite build only, skip typecheck due to pre-existing test issues)
	console.log("  → Building web app (vite only)...");
	const buildResult = spawnSync(process.execPath, [VITE_BIN, "build"], {
		cwd: WEB,
		stdio: "inherit",
	});
	if (buildResult.status !== 0) {
		throw new Error("Web app build failed");
	}

	// La hoja de Web Awesome, resuelta y minificada por esbuild.
	//
	// Es imprescindible y se olvidó en la primera versión: la landing usa
	// `wa-stack`, `wa-cluster`, `wa-grid` y `a.wa-button`, y sin esta hoja el
	// HTML sale con las clases puestas y **ningún estilo detrás**. Se publicó así.
	//
	// No se puede leer con `readFileSync`: `utilities.css` son catorce
	// `@import url(...)` y un `@import` dentro de un `<style>` en línea no
	// resuelve. esbuild los aplana. `--loader:.woff2=empty` porque las fuentes
	// las sirve `theme.css` desde el propio dominio.
	console.log("  → Compilando la hoja de Web Awesome...");
	const waStyles = resolve(
		ROOT,
		"node_modules/@awesome.me/webawesome/dist/styles",
	);
	const waEntry = resolve(waStyles, "_planu-entry.css");
	mkdirSync(DIST, { recursive: true });
	writeFileSync(
		waEntry,
		[
			"@import url('native.css');",
			"@import url('themes/default.css');",
			"@import url('utilities.css');",
		].join("\n"),
		"utf-8",
	);
	const waOut = resolve(DIST, "_wa.css");
	try {
		await esbuild({
			absWorkingDir: waStyles,
			entryPoints: [waEntry],
			bundle: true,
			minify: true,
			loader: { ".woff2": "empty" },
			outfile: waOut,
		});
	} catch (err) {
		throw new Error("esbuild falló compilando la hoja de Web Awesome", {
			cause: err,
		});
	} finally {
		// El temporal se borra pase lo que pase: vive dentro de `node_modules` y
		// dejarlo ahí ensuciaría el paquete para el resto del build.
		rmSync(waEntry, { force: true });
	}
	const webawesomeCss = readFileSync(waOut, "utf-8");
	rmSync(waOut, { force: true });

	// Con hash en el nombre: `/assets/**` se cachea un año como `immutable`, así
	// que un cambio de contenido tiene que cambiar la URL o nadie lo vería.
	const waHash = createHash("sha256")
		.update(webawesomeCss)
		.digest("hex")
		.slice(0, 8);
	const waHref = `/assets/webawesome-${waHash}.css`;
	mkdirSync(resolve(DIST, "assets"), { recursive: true });
	writeFileSync(
		resolve(DIST, `assets/webawesome-${waHash}.css`),
		webawesomeCss,
		"utf-8",
	);
	console.log(`  ✓ ${waHref} (${webawesomeCss.length} B)`);

	// Read CSS files
	const themeCss = readFileSync(
		resolve(ROOT, "apps/web/src/styles/theme.css"),
		"utf-8",
	);
	const landingCss = readFileSync(
		resolve(ROOT, "apps/web/src/landing/landing.css"),
		"utf-8",
	);
	// Nuestros tokens y reglas van en línea —son 3,5 KB y evitan un viaje extra
	// en el camino crítico—; la hoja del framework, 92 KB, va como fichero.
	// Inlinearla reventaba el presupuesto de bytes por cuatro, y con razón: se
	// descargaría entera en cada página en vez de una vez. `/assets/**` lo
	// cachea `firebase.json` un año como immutable.
	//
	// Orden: el framework primero, para que theme.css pueda sobreescribirlo sin
	// `!important`. Por eso el `<link>` va antes del `<style>` en la plantilla.
	const minifiedCss = minifyCss(`${themeCss}\n${landingCss}`);

	// Compile landing.ts to JS using esbuild (bundles dependencies for Node)
	console.log("  → Compiling landing template...");
	// Uno por fichero y con `--outfile`: `--outdir` conserva la estructura de
	// directorios del origen y las rutas de salida dejarían de ser predecibles.
	for (const [entry, outfile] of [
		["apps/web/src/landing/landing.ts", "dist/landing.js"],
		["apps/web/src/landing/legal.ts", "dist/legal.js"],
		["apps/web/src/generated/locales/locale-codes.ts", "dist/locale-codes.js"],
	]) {
		try {
			await esbuild({
				absWorkingDir: ROOT,
				entryPoints: [entry],
				platform: "node",
				format: "esm",
				bundle: true,
				outfile,
				external: ["@lit/localize", "lit"],
			});
		} catch (err) {
			throw new Error(`esbuild falló compilando ${entry}`, { cause: err });
		}
	}

	// Mock window for @lit/localize SSR (it calls window.dispatchEvent)
	globalThis.window = {
		dispatchEvent: () => true,
		addEventListener: () => {},
		removeEventListener: () => {},
	};

	// Import the compiled landing template
	const { landingTemplate, jsonLd, landingTitle, landingDescription } =
		await import(resolve(ROOT, "dist/landing.js"));
	const { privacyPage, termsPage } = await import(
		resolve(ROOT, "dist/legal.js")
	);
	// Compilado, no importado en crudo: importar un `.ts` sólo funciona en Node
	// >= 22, que hace type-stripping. CI corre Node 20 y abortaba el despliegue
	// con ERR_UNKNOWN_FILE_EXTENSION — un fallo que no se ve en local si tu Node
	// es más nuevo que el suyo.
	const { sourceLocale, allLocales } = await import(
		resolve(ROOT, "dist/locale-codes.js")
	);
	const { configureLocalization } = await import(
		"@lit/localize/init/runtime.js"
	);

	// Configure lit-localize for SSR (same as app but for Node)
	const { setLocale } = configureLocalization({
		sourceLocale,
		targetLocales: allLocales.filter((l) => l !== sourceLocale),
		loadLocale: async (locale) => {
			if (locale === sourceLocale) {
				return { templates: undefined };
			}
			const mod = await import(
				resolve(ROOT, `apps/web/src/generated/locales/${locale}.js`)
			);
			return mod;
		},
	});

	// `msg` se importa DESPUÉS de `configureLocalization`, no antes. Una
	// desestructuración captura el valor de `msg` en el momento del `import()`,
	// y `@lit/localize` exporta `let msg = defaultMsg` —la identidad, sin
	// traducir— hasta que `configureLocalization` lo reemplaza con la
	// implementación real. Importarlo antes deja esta variable local congelada
	// en la identidad para siempre: es justo lo que hacía que `privacyPage()` y
	// `termsPage()` salieran en inglés en `/es/`, mientras que `landingTemplate()`
	// se libraba porque su `msg` vive en `dist/landing.js`, un módulo
	// compilado aparte que resuelve el export en el momento de ejecutarse, no
	// en el momento de importarse.
	const { msg } = await import("@lit/localize");

	/**
	 * Renderiza una plantilla para un idioma, sustituye los placeholders
	 * comunes y la escribe en uno o más ficheros de destino. Compartida entre
	 * la landing y las dos páginas legales de T30: las tres pasan por el mismo
	 * inlining de CSS, el mismo prefijo de idioma y el mismo presupuesto de
	 * bytes, y duplicarlo por página habría sido el primer sitio donde una de
	 * las dos se desincroniza de la otra sin que nadie lo note.
	 */
	async function renderAndWrite({
		locale,
		template,
		fileName,
		extraReplacements = [],
	}) {
		const result = await render(template);

		// @lit-labs/ssr returns an async iterator, consume it to get the HTML string
		let html = "";
		for await (const chunk of result) {
			html += chunk;
		}

		html = html
			.replace("<!--INLINE_CSS_PLACEHOLDER-->", minifiedCss)
			.replace("__WA_STYLESHEET__", waHref)
			// Prefijo de idioma de los enlaces internos: el de origen vive en la
			// raíz, los demás bajo /{locale}. Centinela plano y no comentario
			// HTML, porque va dentro de atributos y ahí se escaparía.
			.replaceAll(
				"__LOCALE_PREFIX__",
				locale === sourceLocale ? "" : `/${locale}`,
			)
			// Anclado al <html>: un replace ciego de `lang="en"` también tocaría
			// cualquier `lang` del contenido, y el primero no siempre es el del
			// documento.
			.replace(/<html lang="[^"]*"/, `<html lang="${locale}"`);

		for (const [placeholder, value] of extraReplacements) {
			html = html.replace(placeholder, value);
		}

		// Cada idioma se escribe donde el `hreflang` del propio HTML promete que
		// está, y el de origen además en la raíz como `x-default`. Antes sólo se
		// escribía `localized/{locale}/`, así que las tres URLs anunciadas a los
		// buscadores —`/`, `/en/` y `/es/`— eran 404.
		const targets = [resolve(DIST, locale, fileName)];
		if (locale === sourceLocale) {
			targets.push(resolve(DIST, fileName));
		}

		html = stripLitMarkers(html);

		const bytes = Buffer.byteLength(html, "utf-8");
		if (bytes > HTML_BUDGET_BYTES) {
			throw new Error(
				`El HTML de "${locale}/${fileName}" pesa ${bytes} B y el tope es ` +
					`${HTML_BUDGET_BYTES} B. Adelgaza el CSS en línea o el contenido; ` +
					"subir el tope es la última opción, no la primera.",
			);
		}

		const written = [];
		for (const target of targets) {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, html, "utf-8");
			written.push(target);
			console.log(`  ✓ ${relative(ROOT, target)}`);
		}
		console.log(`    ${bytes} B / ${HTML_BUDGET_BYTES} B`);
		return written;
	}

	// For each locale, render and write
	const writtenPages = [];
	for (const locale of allLocales) {
		console.log(`  → Rendering ${locale}...`);
		await setLocale(locale);

		// `landingTitle()`/`landingDescription()`, no `msg()` suelto aquí: viven
		// en `landing.ts`, donde `lit-localize extract` sí las ve. Ver el
		// comentario junto a su definición.
		const title = landingTitle();
		const description = landingDescription();

		writtenPages.push(
			...(await renderAndWrite({
				locale,
				template: landingTemplate(),
				fileName: "index.html",
				extraReplacements: [
					["<!--TITLE_PLACEHOLDER-->", title],
					["<!--DESCRIPTION_PLACEHOLDER-->", description],
					["<!--OG_TITLE_PLACEHOLDER-->", title],
					["<!--OG_DESC_PLACEHOLDER-->", description],
					["<!--JSON_LD_PLACEHOLDER-->", jsonLd()],
				],
			})),
		);

		writtenPages.push(
			...(await renderAndWrite({
				locale,
				template: privacyPage(),
				fileName: "privacy.html",
				extraReplacements: [
					["<!--TITLE_PLACEHOLDER-->", `${msg("Privacy Policy")} — planu`],
				],
			})),
		);

		writtenPages.push(
			...(await renderAndWrite({
				locale,
				template: termsPage(),
				fileName: "terms.html",
				extraReplacements: [
					["<!--TITLE_PLACEHOLDER-->", `${msg("Terms of Service")} — planu`],
				],
			})),
		);
	}

	// Copy landing assets to dist/assets/landing
	if (existsSync(ASSETS_LANDING)) {
		cpSync(ASSETS_LANDING, resolve(DIST, "assets/landing"), {
			recursive: true,
		});
		console.log(`  ✓ Copied assets to dist/assets/landing`);
	}

	// Copy fonts to dist/fonts
	if (existsSync(FONTS_SOURCE)) {
		cpSync(FONTS_SOURCE, FONTS_DEST, { recursive: true });
		console.log(`  ✓ Copied fonts to dist/fonts`);
	}

	// Copy app build output to dist (app.html, assets, robots.txt)
	if (existsSync(APP_DIST)) {
		cpSync(APP_DIST, DIST, { recursive: true });
		console.log(`  ✓ Copied app build to dist/`);
	}

	// Un 404 en la imagen del hero es un LCP roto, y en un HTML sin JavaScript
	// no hay nada que lo remedie en cliente. No aborta el build —el pipeline es
	// lo que cierra T28, las imágenes son contenido de T29— pero se dice.
	const missing = missingAssets(writtenPages);
	if (missing.length > 0) {
		console.warn(
			`  ⚠️  Referenciados y ausentes en dist/: ${missing.join(", ")}`,
		);
	}

	console.log("✅ Landing build complete");
}

buildLanding().catch((err) => {
	console.error("❌ Build failed:", err);
	process.exit(1);
});
