import { msg } from "@lit/localize";
import { html, nothing, type TemplateResult } from "lit";
import { cookiesNotice, copyrightNotice } from "./legal.js";

/**
 * Iconos en línea, no `<wa-icon>`.
 *
 * Dos razones, y las dos son bloqueantes en esta página:
 *
 * 1. **La landing no carga JavaScript** (lo exige T29 y lo comprueba el build:
 *    el único `<script>` es el JSON-LD). Un custom element que nunca se define
 *    no pinta nada, así que los `<wa-icon>` salían como huecos vacíos.
 * 2. **`<wa-icon>` descarga los SVG de `ka-p.fontawesome.com`**, un origen que
 *    la CSP de `firebase.json` no permite y que rompería la línea base de «cero
 *    orígenes ajenos al arrancar» de AGENTS.md.
 *
 * Los trazados son de Font Awesome Free 6 (CC BY 4.0), la misma biblioteca que
 * usa Web Awesome por defecto, así que la aplicación y la landing dibujan el
 * mismo icono. `aria-hidden` porque cada uno acompaña a un encabezado que ya
 * dice lo mismo.
 */
/**
 * Prefijo de ruta del idioma que se está renderizando. El build lo sustituye,
 * como el `lang` del `<html>`: vacío para el idioma de origen (vive en la raíz)
 * y `/es` para el resto.
 */
const LOCALE_PREFIX = "__LOCALE_PREFIX__";

/** Public origin of the site; the build also derives each page's canonical URL from it. */
export const SITE_ORIGIN = "https://planu-app.web.app";
const HOME_URL = `${SITE_ORIGIN}/`;
const OG_IMAGE_URL = `${SITE_ORIGIN}/assets/landing/og.png`;
const OG_IMAGE_WIDTH = "1200";
const OG_IMAGE_HEIGHT = "630";

/** Alt text of the social card image, shared by Open Graph and Twitter. */
function ogImageAlt(): string {
	return msg("planu, the private event planner");
}
const ICON_PATHS: Record<string, { viewBox: string; path: string }> = {
	lock: {
		viewBox: "0 0 448 512",
		path: "M144 144l0 48 160 0 0-48c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192l0-48C80 64.5 144.5 0 224 0s144 64.5 144 144l0 48 16 0c35.3 0 64 28.7 64 64l0 192c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 256c0-35.3 28.7-64 64-64l16 0z",
	},
	"share-nodes": {
		viewBox: "0 0 448 512",
		path: "M352 224c53 0 96-43 96-96s-43-96-96-96s-96 43-96 96c0 4 .2 8 .7 11.9l-94.1 47C145.4 170.2 121.9 160 96 160c-53 0-96 43-96 96s43 96 96 96c25.9 0 49.4-10.2 66.6-26.9l94.1 47c-.5 3.9-.7 7.8-.7 11.9c0 53 43 96 96 96s96-43 96-96s-43-96-96-96c-25.9 0-49.4 10.2-66.6 26.9l-94.1-47c.5-3.9 .7-7.8 .7-11.9s-.2-8-.7-11.9l94.1-47C302.6 213.8 326.1 224 352 224z",
	},
	"calendar-days": {
		viewBox: "0 0 448 512",
		path: "M128 0c17.7 0 32 14.3 32 32l0 32 128 0 0-32c0-17.7 14.3-32 32-32s32 14.3 32 32l0 32 48 0c26.5 0 48 21.5 48 48l0 48L0 160l0-48C0 85.5 21.5 64 48 64l48 0 0-32c0-17.7 14.3-32 32-32zM0 192l448 0 0 272c0 26.5-21.5 48-48 48L48 512c-26.5 0-48-21.5-48-48L0 192zm64 80l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm128 0l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm144-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0zM64 400l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm128 0l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm144-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0z",
	},
	image: {
		viewBox: "0 0 512 512",
		path: "M0 96C0 60.7 28.7 32 64 32l384 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zM323.8 202.5c-4.5-6.6-11.9-10.5-19.8-10.5s-15.4 3.9-19.8 10.5l-87 127.6L170.7 297c-4.6-5.7-11.5-9-18.7-9s-14.2 3.3-18.7 9l-64 80c-5.8 7.2-6.9 17.1-2.9 25.4s12.4 13.6 21.6 13.6l96 0 32 0 208 0c8.9 0 17.1-4.9 21.2-12.8s3.6-17.4-1.4-24.7l-120-176zM112 192a48 48 0 1 0 0-96 48 48 0 1 0 0 96z",
	},
};

function icon(name: string): TemplateResult {
	const glyph = ICON_PATHS[name];
	if (!glyph) throw new Error(`Icono desconocido: ${name}`);
	return html`<svg
		class="feature-icon"
		viewBox="${glyph.viewBox}"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
		focusable="false"
	><path d="${glyph.path}" fill="currentColor" /></svg>`;
}

/** Landing page template — rendered to static HTML at build time via @lit-labs/ssr */
export function landingTemplate(): TemplateResult {
	return html`
		<!doctype html>
		<html lang="en" class="wa-theme-planu wa-palette-default wa-light">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title><!--TITLE_PLACEHOLDER--></title>
				<meta name="description" content="<!--DESCRIPTION_PLACEHOLDER-->" />
				<!--
					Sólo los dos pesos que el hero pinta por encima del pliegue: el
					h1 en Belleza 400 y el párrafo en Alegreya 400. Sin esto, el
					font-display: swap del ADR 0008 -deliberado, para no dejar
					texto invisible- pinta primero con la fuente de sistema y la
					sustituye al llegar la real, y ese cambio de métricas es lo que
					Lighthouse medía como "Web font loaded" en el CLS del hero.
				-->
				<link rel="preload" as="font" type="font/woff2" href="/fonts/belleza-latin-400.woff2" crossorigin="anonymous" />
				<link rel="preload" as="font" type="font/woff2" href="/fonts/alegreya-latin-400.woff2" crossorigin="anonymous" />
				<link rel="icon" href="/logo.svg" type="image/svg+xml" />
				<meta property="og:title" content="<!--OG_TITLE_PLACEHOLDER-->" />
				<meta property="og:description" content="<!--OG_DESC_PLACEHOLDER-->" />
				<meta property="og:type" content="website" />
				<meta property="og:site_name" content="planu" />
					<meta property="og:url" content="<!--OG_URL_PLACEHOLDER-->" />
					<!--OG_LOCALE_PLACEHOLDER-->
				<meta property="og:image" content="${OG_IMAGE_URL}" />
					<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
					<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
					<meta property="og:image:alt" content="${ogImageAlt()}" />
				<meta name="twitter:card" content="summary_large_image" />
					<meta name="twitter:title" content="<!--OG_TITLE_PLACEHOLDER-->" />
					<meta name="twitter:description" content="<!--OG_DESC_PLACEHOLDER-->" />
					<meta name="twitter:image" content="${OG_IMAGE_URL}" />
					<meta name="twitter:image:alt" content="${ogImageAlt()}" />
				<!--CANONICAL_PLACEHOLDER-->
				<link rel="alternate" hreflang="es" href="${SITE_ORIGIN}/es/" />
				<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/en/" />
				<link rel="alternate" hreflang="x-default" href="${HOME_URL}" />
				<script type="application/ld+json"><!--JSON_LD_PLACEHOLDER--></script>
				<link rel="stylesheet" href="__WA_STYLESHEET__" />
				<style><!--INLINE_CSS_PLACEHOLDER--></style>
			</head>
			<body>
				${header()}
				<main>
					${hero()}
					${features()}
					${steps()}
					${rules()}
					${closing()}
				</main>
				${footer()}
			</body>
		</html>
	`;
}

export function header(): TemplateResult {
	// Built outside the template for the same lit-analyzer reason as in legal.ts.
	const home = `${LOCALE_PREFIX}/`;
	return html`
		<header class="site-header wa-cluster wa-justify-content-space-between wa-align-items-center">
			<a href="${home}" class="site-logo"><img src="/logo.svg" alt="planu" width="48" height="48" /></a>
			<a href="/app/login" class="wa-button wa-plain">${msg("Sign in")}</a>
		</header>
	`;
}

export function hero(): TemplateResult {
	// The CTA deep-links to the sign-up tab of the login view (GH-271).
	return html`
		<section class="hero wa-stack wa-gap-l">
			<div class="wa-stack wa-gap-m">
				<h1 class="wa-heading-3xl">${msg("Plan your events. Share them only with the people you choose.")}</h1>
				<p class="wa-font-size-l wa-color-text-quiet">${msg("Dinners, get-togethers, group plans: keep each one with its place, dates, tags and image. It's yours alone until you invite someone as a viewer or an editor.")}</p>
				<div class="wa-cluster wa-gap-s wa-justify-content-center">
					<a href="/app/login?mode=signup" class="wa-button wa-brand wa-size-l">${msg("Create your account")}</a>
				</div>
				<p class="wa-font-size-s wa-color-text-quiet">${msg("With your email or Google. The rest is up to you.")}</p>
			</div>
			<figure class="hero-figure">
				<picture>
					<source
						media="(max-width: 600px)"
						srcset="${msg("/assets/landing/hero-mobile-en.webp")}"
					/>
					<!-- @ts-ignore lit-analyzer does not know the standard fetchpriority
					     attribute yet; it is what makes the browser load the LCP image first. -->
					<img
						src="${msg("/assets/landing/hero-en.webp")}"
						alt="${msg("The planu event list with sample events: cover image, date and place on each card")}"
						width="1200"
						height="675"
						fetchpriority="high"
					/>
				</picture>
			</figure>
		</section>
	`;
}

function features(): TemplateResult {
	return html`
		<section class="features wa-stack wa-gap-xl">
			<div class="wa-stack wa-gap-l">
				<header class="wa-stack wa-gap-xs">
					<h2 class="wa-heading-2xl">${msg("What you can do with planu")}</h2>
				</header>
				<div class="feature-grid wa-grid wa-gap-l">
					${featureCard(
						"lock",
						msg("Private until you say so"),
						msg(
							"Your events stay yours alone. Only the people you invite can see them.",
						),
					)}
					${featureCard(
						"share-nodes",
						msg("Viewer or editor, you choose"),
						msg(
							"Invite someone by email and decide whether they only look or can edit too. They need a planu account and accept the invitation, and you can take their access away whenever you like.",
						),
						{
							src: msg("/assets/landing/share-en.webp"),
							alt: msg(
								"The planu share dialog for an event: the owner, and a guest invited as a viewer",
							),
							width: 544,
							height: 600,
						},
					)}
					${featureCard(
						"image",
						msg("From a poster or a text to an event"),
						msg(
							"Upload a photo of a poster or paste an announcement and planu fills in the event for you. You review it before saving. It works in browsers with built-in AI, like desktop Chrome, and the reading happens on your device.",
						),
					)}
					${featureCard(
						"calendar-days",
						msg("To your calendar"),
						msg(
							"Download an event, or your filtered agenda, as an .ics file. A single event can also go to Google Calendar in one click.",
						),
						{
							src: msg("/assets/landing/export-en.webp"),
							alt: msg(
								"The planu event list with the Export calendar menu open, offering to download an .ics file",
							),
							width: 1200,
							height: 420,
						},
					)}
				</div>
			</div>
		</section>
	`;
}

function step(title: string, description: string): TemplateResult {
	return html`
		<li>
			<h3 class="wa-heading-l">${title}</h3>
			<p class="wa-color-text-quiet">${description}</p>
		</li>
	`;
}

function steps(): TemplateResult {
	return html`
		<section class="steps">
			<div class="wa-stack wa-gap-l">
				<h2 class="wa-heading-2xl">${msg("How to start")}</h2>
				<ol class="steps-list wa-stack wa-gap-l">
					${step(
						msg("Create your account"),
						msg(
							"With your email or Google. If you use email, confirm it from the message we send you.",
						),
					)}
					${step(
						msg("Add your first event"),
						msg(
							"Write it yourself or, if your browser supports it, let the AI read a poster or a text for you. Give it a title, a place, dates with or without a time, up to 10 tags and an image.",
						),
					)}
					${step(
						msg("Share it or take it with you"),
						msg(
							"Invite people who have a planu account as viewers or editors, or download it to your calendar.",
						),
					)}
				</ol>
			</div>
		</section>
	`;
}

// Roles as in ADR 0006 and firestore.rules: the owner does everything, an
// editor changes the content only (storage.rules lets only the owner write
// cover images, so the editor's line promises none), a viewer only reads.
function rule(role: string, description: string): TemplateResult {
	return html`
		<div class="rule">
			<dt class="wa-heading-s">${role}</dt>
			<dd class="wa-color-text-quiet">${description}</dd>
		</div>
	`;
}

function rules(): TemplateResult {
	return html`
		<section class="rules">
			<div class="wa-stack wa-gap-l">
				<h2 class="wa-heading-2xl">${msg("Your events, your rules")}</h2>
				<dl class="wa-stack wa-gap-s">
					${rule(
						msg("You"),
						msg("You read, edit, invite, remove access and delete the event."),
					)}
					${rule(
						msg("Editor"),
						msg("Reads and edits the content. Can't invite or delete."),
					)}
					${rule(msg("Viewer"), msg("Only reads."))}
				</dl>
				<p class="wa-color-text-quiet">${msg("Anyone can leave an event that was shared with them, and you can delete your account whenever you want.")}</p>
			</div>
		</section>
	`;
}

/** A capture of the app under a benefit: below the fold, so it loads lazily. */
interface Shot {
	src: string;
	alt: string;
	width: number;
	height: number;
}
function featureCard(
	iconName: string,
	title: string,
	description: string,
	shot?: Shot,
): TemplateResult {
	return html`
		<article class="feature-card wa-stack wa-gap-s">
			${icon(iconName)}
			<h3 class="wa-heading-l">${title}</h3>
			<p class="wa-color-text-quiet">${description}</p>
			${
				shot
					? html`<img
						class="feature-shot"
						src=${shot.src}
						alt=${shot.alt}
						width=${shot.width}
						height=${shot.height}
						loading="lazy"
						decoding="async"
					/>`
					: nothing
			}
		</article>
	`;
}

/** The second and last call to action, with the way in for who already has an account. */
function closing(): TemplateResult {
	return html`
		<section class="closing wa-stack wa-gap-m">
			<h2 class="wa-heading-2xl">${msg("Start with your first event")}</h2>
			<div class="wa-cluster wa-justify-content-center">
				<a href="/app/login?mode=signup" class="wa-button wa-brand wa-size-l">${msg("Create your account")}</a>
			</div>
			<p class="wa-font-size-s wa-color-text-quiet">${msg("Already have an account?")} <a href="/app/login">${msg("Sign in")}</a></p>
		</section>
	`;
}
function footer(): TemplateResult {
	// El aviso de cookies vive en el pie de toda página de la landing, no sólo
	// en privacy.html: ADR 0009 hace que Firebase Analytics corra en la
	// primera visita, así que el aviso tiene que estar ya en la primera página
	// que se pinta, no detrás de un enlace que nadie tiene por qué seguir.
	// Los legales viven bajo el prefijo del idioma, salvo el de origen, que está
	// en la raíz. Codificarlo aquí evita que la versión inglesa enlazara a `/es/`,
	// que es lo que hacía antes.
	const base = LOCALE_PREFIX;
	return html`
		<footer class="wa-stack wa-gap-m">
			<div class="wa-cluster wa-gap-m wa-justify-content-center wa-font-size-s wa-color-text-quiet">
				<a href="${base}/privacy.html">${msg("Privacy")}</a>
				<span aria-hidden="true">·</span>
				<a href="${base}/terms.html">${msg("Terms")}</a>
				<span aria-hidden="true">·</span>
				<a href="mailto:hello@planu.app">${msg("Contact")}</a>
			</div>
			<p class="wa-font-size-xs wa-color-text-quiet">${copyrightNotice()}</p>
			${cookiesNotice()}
		</footer>
	`;
}

/**
 * Título y descripción de la landing.
 *
 * Exportados, y no una constante de módulo del script de build: `msg()` sólo
 * traduce si `lit-localize extract` la ve, y su configuración sólo analiza
 * `apps/web/src/**`. Una llamada a `msg()` en `scripts/build-landing.js` nunca
 * llega al XLIFF, así que salía siempre en inglés en `/es/` aunque
 * `configureLocalization` ya estuviera en español — el título de la pestaña
 * era el único sitio de la landing donde eso pasaba desapercibido.
 */
export function landingTitle(): string {
	return msg("planu — Plan your events, privately");
}

export function landingDescription(): string {
	return msg(
		"Create, search and filter events with title, description, location, dates and cover image. Private by default — only you can see yours.",
	);
}

export function jsonLd(): string {
	const data = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "planu",
		applicationCategory: "ProductivityApplication",
		operatingSystem: "Web",
		description: landingDescription(),
		url: `${SITE_ORIGIN}/`,
	};
	return JSON.stringify(data);
}
