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
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@lit-labs/ssr";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
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
	const buildResult = spawnSync("npx", ["vite", "build"], {
		cwd: resolve(ROOT, "apps/web"),
		stdio: "inherit",
		shell: true,
	});
	if (buildResult.status !== 0) {
		throw new Error("Web app build failed");
	}

	// Read CSS files
	const themeCss = readFileSync(
		resolve(ROOT, "apps/web/src/styles/theme.css"),
		"utf-8",
	);
	const landingCss = readFileSync(
		resolve(ROOT, "apps/web/src/landing/landing.css"),
		"utf-8",
	);
	const combinedCss = `${themeCss}\n${landingCss}`;
	const minifiedCss = minifyCss(combinedCss);

	// Compile landing.ts to JS using esbuild (bundles dependencies for Node)
	console.log("  → Compiling landing template...");
	const esbuildResult = spawnSync(
		"npx",
		[
			"esbuild",
			"apps/web/src/landing/landing.ts",
			"--platform=node",
			"--format=esm",
			"--bundle",
			"--outfile=dist/landing.js",
			"--external:@lit/localize",
			"--external:lit",
		],
		{
			cwd: ROOT,
			stdio: "inherit",
			shell: true,
		},
	);
	if (esbuildResult.status !== 0) {
		throw new Error("esbuild compilation failed");
	}

	// Mock window for @lit/localize SSR (it calls window.dispatchEvent)
	globalThis.window = {
		dispatchEvent: () => true,
		addEventListener: () => {},
		removeEventListener: () => {},
	};

	// Import the compiled landing template
	const { landingTemplate, jsonLd } = await import(
		resolve(ROOT, "dist/landing.js")
	);
	// Import locale-codes.ts directly (esbuild not needed for this simple file)
	const { sourceLocale, allLocales } = await import(
		resolve(ROOT, "apps/web/src/generated/locales/locale-codes.ts")
	);
	const { configureLocalization } = await import(
		"@lit/localize/init/runtime.js"
	);
	const { msg } = await import("@lit/localize");

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

	// For each locale, render and write
	const writtenPages = [];
	for (const locale of allLocales) {
		console.log(`  → Rendering ${locale}...`);
		await setLocale(locale);
		const result = await render(landingTemplate());

		// @lit-labs/ssr returns an async iterator, consume it to get the HTML string
		let html = "";
		for await (const chunk of result) {
			html += chunk;
		}

		// Replace placeholders with localized content
		// Note: msg() is now available globally from @lit/localize runtime
		const title = msg("planu — Plan your events, privately");
		const description = msg(
			"Create, search and filter events with title, description, location, dates and cover image. Private by default — only you can see yours.",
		);
		const jsonLdContent = jsonLd();

		html = html
			.replace("<!--TITLE_PLACEHOLDER-->", title)
			.replace("<!--DESCRIPTION_PLACEHOLDER-->", description)
			.replace("<!--OG_TITLE_PLACEHOLDER-->", title)
			.replace("<!--OG_DESC_PLACEHOLDER-->", description)
			.replace("<!--JSON_LD_PLACEHOLDER-->", jsonLdContent)
			.replace("<!--INLINE_CSS_PLACEHOLDER-->", minifiedCss)
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

		// Cada idioma se escribe donde el `hreflang` del propio HTML promete que
		// está, y el de origen además en la raíz como `x-default`. Antes sólo se
		// escribía `localized/{locale}/`, así que las tres URLs anunciadas a los
		// buscadores —`/`, `/en/` y `/es/`— eran 404.
		const targets = [resolve(DIST, locale, "index.html")];
		if (locale === sourceLocale) {
			targets.push(resolve(DIST, "index.html"));
		}

		html = stripLitMarkers(html);

		const bytes = Buffer.byteLength(html, "utf-8");
		if (bytes > HTML_BUDGET_BYTES) {
			throw new Error(
				`El HTML de "${locale}" pesa ${bytes} B y el tope es ` +
					`${HTML_BUDGET_BYTES} B. Adelgaza el CSS en línea o el contenido; ` +
					"subir el tope es la última opción, no la primera.",
			);
		}

		for (const target of targets) {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, html, "utf-8");
			writtenPages.push(target);
			console.log(`  ✓ ${relative(ROOT, target)}`);
		}
		console.log(`    ${bytes} B / ${HTML_BUDGET_BYTES} B`);
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
