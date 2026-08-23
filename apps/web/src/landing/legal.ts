import { msg } from "@lit/localize";
import { html, type TemplateResult } from "lit";

/**
 * Privacidad, términos y aviso de cookies (T30).
 *
 * Misma disciplina que el resto de la landing: prerrenderizado, sin
 * JavaScript, `light DOM`, con `LOCALE_PREFIX` para los enlaces internos.
 *
 * El contenido describe el tratamiento **real**, no uno hipotético — el ADR
 * 0009 de analítica es lo que decide si esta página lleva aviso de cookies, y
 * lo lleva porque la elección fue Firebase Analytics, que sí las usa. Nada
 * aquí promete lo que el código todavía no hace: T32 (borrado de cuenta) no
 * está construida, así que esta página no dice que exista un botón para
 * borrarlo todo — dice a quién escribir.
 */

const LOCALE_PREFIX = "__LOCALE_PREFIX__";

function legalHeader(title: string): TemplateResult {
	// Built outside the template, not `href="${LOCALE_PREFIX}/"`: lit-analyzer's
	// `no-unintended-mixed-binding` flags a binding directly followed by a
	// literal `/` as a likely accidental double slash, even though the build
	// substitutes `LOCALE_PREFIX` to either `""` or `/{locale}` and the result
	// is correct either way. One bound value sidesteps the false positive
	// without changing the rendered HTML.
	const backHref = `${LOCALE_PREFIX}/`;
	return html`
		<header class="wa-stack wa-gap-xs legal-header">
			<a class="legal-back" href="${backHref}">${msg("← Back to planu")}</a>
			<h1 class="wa-text-3xl wa-text-bold">${title}</h1>
			<p class="wa-color-text-quiet wa-text-sm">
				${msg("Last updated: 22 August 2026")}
			</p>
		</header>
	`;
}

function legalFooter(): TemplateResult {
	const base = LOCALE_PREFIX;
	return html`
		<footer class="wa-stack wa-gap-m">
			<div class="wa-cluster wa-gap-m wa-justify-content-center wa-text-sm wa-color-text-quiet">
				<a href="${base}/privacy.html">${msg("Privacy")}</a>
				<span aria-hidden="true">·</span>
				<a href="${base}/terms.html">${msg("Terms")}</a>
				<span aria-hidden="true">·</span>
				<a href="mailto:hello@planu.app">${msg("Contact")}</a>
			</div>
			<p class="wa-text-xs wa-color-text-quiet">
				${msg("© 2025 planu. Built with Lit, Web Awesome and Firebase.")}
			</p>
			${cookiesNotice()}
		</footer>
	`;
}

function legalPageShell(title: string, body: TemplateResult): TemplateResult {
	return html`
		<!doctype html>
		<html lang="en" class="wa-theme-default wa-palette-default wa-light">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title><!--TITLE_PLACEHOLDER--></title>
				<meta name="robots" content="noindex" />
				<link rel="icon" href="/logo.svg" type="image/svg+xml" />
				<link rel="stylesheet" href="__WA_STYLESHEET__" />
				<style><!--INLINE_CSS_PLACEHOLDER--></style>
			</head>
			<body>
				<main class="legal-page">
					${legalHeader(title)}
					<div class="wa-prose">${body}</div>
				</main>
				${legalFooter()}
			</body>
		</html>
	`;
}

/**
 * Política de privacidad.
 *
 * Cada apartado corresponde a un dato que la aplicación toca de verdad, no a
 * una plantilla genérica: cuenta (Firebase Auth), eventos y directorio
 * (Firestore), imágenes (Storage), generación con IA (ADR 0003), analítica
 * (ADR 0009) y errores (Sentry). Ninguno se documenta si el código no lo
 * hace todavía.
 */
export function privacyPage(): TemplateResult {
	return legalPageShell(
		msg("Privacy Policy"),
		html`
			<p>
				${msg(
					"planu is a private event planner. This page describes what we actually collect, why, and who else sees it — not a generic template. If a paragraph here stops matching the code, the code is what changes, not this page.",
				)}
			</p>

			<h2>${msg("Your account")}</h2>
			<p>
				${msg(
					"Signing up with email and password, or with Google, is handled by Firebase Authentication. We store your email, and — if you sign in with Google — the name and photo your Google account already shares with sites you sign into. We never see or store your password: Firebase does that.",
				)}
			</p>

			<h2>${msg("Your events")}</h2>
			<p>
				${msg(
					"Events are private by default: only you can read one you created, unless you explicitly invite someone. Title, description, location, dates and tags live in our database and are never public — see the security section below for what that promise does and does not cover.",
				)}
			</p>

			<h2>${msg("Sharing an event")}</h2>
			<p>
				${msg(
					"To invite someone by email, your device turns that email into a fingerprint (a one-way hash) and looks it up against a directory every user publishes to — never a list of raw emails. Whoever you invite sees your name and photo, never your email address, and you see theirs the same way.",
				)}
			</p>

			<h2>${msg("Event cover images")}</h2>
			<p>
				${msg(
					"An uploaded cover photo goes to Firebase Storage under a path tied to your account. Reading the event's text always requires being signed in as someone with access; the image link itself does not check your session — it works from an unguessable address instead. Do not use a cover photo for something you would not want reachable by whoever gets hold of that address.",
				)}
			</p>

			<h2>${msg("AI-assisted event creation")}</h2>
			<p>
				${msg(
					"Creating an event from a photo or pasted text can use on-device AI (Chrome's built-in model) or cloud AI (Google's Gemini), depending on your browser and device. Today, cloud AI is switched off in the code — every request runs on your own device, and the photo or text never leaves it. If cloud AI is ever turned back on, this page will say so before it happens, and it will only run for accounts explicitly granted that access.",
				)}
			</p>

			<h2>${msg("Activity we measure")}</h2>
			<p>
				${msg(
					"We use Firebase Analytics (Google Analytics) to count five things: that you visited, that you signed up, that you created your first event, that you shared an event, and that you used AI to create one. We never send what you typed — no titles, no descriptions, no locations, no dates, no names. See the cookie notice below for what this means for your browser.",
				)}
			</p>

			<h2>${msg("Error reports")}</h2>
			<p>
				${msg(
					"If something breaks, a bare error report — no personal data attached by us — can be sent to Sentry, our error-tracking tool, so we can fix it. This is off entirely unless the deployment you are using has it configured.",
				)}
			</p>

			<h2>${msg("What protects this, and what it does not yet")}</h2>
			<p>
				${msg(
					"Firestore and Storage security rules enforce every promise above at the database level, not just in what the interface shows you — tested against real attacks, not assumed. Two things they do not cover: the cover image's address is guessable-resistant, not access-controlled, as noted above; and the type of an uploaded file is declared by your browser and not checked against its actual content.",
				)}
			</p>

			<h2>${msg("Deleting your data")}</h2>
			<p>
				${msg(
					"There is no self-service “delete my account” button yet. Until there is, write to the address below and we will remove your account and everything tied to it by hand.",
				)}
			</p>

			<h2>${msg("Who to contact")}</h2>
			<p>
				${msg("Questions about any of this: ")}
				<a href="mailto:hello@planu.app">hello@planu.app</a>.
			</p>

			<h2>${msg("Not legal advice")}</h2>
			<p>
				${msg(
					"This page is an honest description of what the product does, written by the people who built it — not a lawyer, and not a substitute for one.",
				)}
			</p>
		`,
	);
}

/** Términos de servicio. */
export function termsPage(): TemplateResult {
	return legalPageShell(
		msg("Terms of Service"),
		html`
			<p>
				${msg(
					"planu is a free product with no paid plan. These terms describe what that means in practice, not a template written for a business model we do not have.",
				)}
			</p>

			<h2>${msg("The service")}</h2>
			<p>
				${msg(
					"planu lets you create, search and filter your own events, and optionally share individual events with people you invite. It is provided as-is, free of charge, with no service-level guarantee: we have no paid plan and no support contract to promise uptime against.",
				)}
			</p>

			<h2>${msg("Your account")}</h2>
			<p>
				${msg(
					"You are responsible for the accuracy of what you enter and for keeping your account credentials to yourself. Sharing an event hands the person you invite the role you chose — viewer or editor — and nothing more; you can change or remove that access at any time from the event's share dialog.",
				)}
			</p>

			<h2>${msg("Acceptable use")}</h2>
			<p>
				${msg(
					"Do not use planu to store or share content that is illegal, or that you do not have the right to share with the people you invite. Do not attempt to access another account's data by circumventing the application — the security rules described in our privacy policy exist precisely to stop that, and attempting it is not permitted even where it happens to fail.",
				)}
			</p>

			<h2>${msg("Changes")}</h2>
			<p>
				${msg(
					"We may change these terms as the product changes. Meaningful changes will be reflected on this page with an updated date at the top.",
				)}
			</p>

			<h2>${msg("Who to contact")}</h2>
			<p>
				${msg("Questions about these terms: ")}
				<a href="mailto:hello@planu.app">hello@planu.app</a>.
			</p>

			<h2>${msg("Not legal advice")}</h2>
			<p>
				${msg(
					"This page is an honest description of the product's terms, written by the people who built it — not a lawyer, and not a substitute for one.",
				)}
			</p>
		`,
	);
}

/**
 * Aviso de cookies.
 *
 * Existe **porque** ADR 0009 eligió Firebase Analytics, que usa
 * `localStorage`/cookies para el identificador de cliente. Con Umami o
 * Plausible esta página no haría falta — así lo deja escrito el propio ADR.
 *
 * Sin banner interactivo: la landing no carga JavaScript (T29) y un banner
 * que pida consentimiento con un botón necesitaría guardar esa elección en
 * algún sitio, que es JavaScript por definición. Se documenta aquí, enlazado
 * desde el pie, en vez de fingir un control que la página no puede ofrecer sin
 * dejar de ser una landing sin JavaScript.
 */
export function cookiesNotice(): TemplateResult {
	return html`
		<section class="wa-stack wa-gap-xs cookie-notice">
			<p class="wa-text-xs wa-color-text-quiet">
				${msg(
					"planu uses Firebase Analytics (Google Analytics), which stores a small identifier in your browser to recognise repeat visits. It never contains anything you typed — see our ",
				)}
				<a href="${LOCALE_PREFIX}/privacy.html">${msg("privacy policy")}</a>.
			</p>
		</section>
	`;
}
