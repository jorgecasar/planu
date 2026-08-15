/**
 * Verifica de extremo a extremo que un error nacido en el bundle sale hacia
 * Sentry con la información que hace falta para simbolicarlo.
 *
 * No consulta la API de Sentry: el token del proyecto tiene ámbito `org:ci` y
 * no puede leer incidencias. En vez de eso intercepta la petición saliente, que
 * además demuestra más — que el evento se **envía**, y con qué contenido.
 *
 * Apunta a producción y envía un evento real, así que **no** lo ejecuta CI:
 * se lanza a mano tras un cambio en la observabilidad.
 */

// Se ejecuta desde la raíz del repo, así que `playwright` resuelve solo.
import { chromium } from "playwright";

const TARGET = process.argv[2] ?? "https://planu-app.web.app";
const TIMEOUT = 45_000;

const browser = await chromium.launch();
const page = await browser.newPage();

/** Envelopes capturados hacia el ingest de Sentry. */
const envelopes = [];

page.on("request", (req) => {
	const url = req.url();
	if (!url.includes("ingest") || !url.includes("sentry.io")) return;
	envelopes.push({ url, body: req.postData() ?? "" });
});

const consoleErrors = [];
page.on("console", (m) => {
	if (m.type() === "error") consoleErrors.push(m.text());
});

console.log(`Abriendo ${TARGET}`);
await page.goto(TARGET, { waitUntil: "networkidle", timeout: TIMEOUT });

// El SDK se carga tras el pintado y en diferido; hay que darle su tiempo.
console.log("Esperando a que cargue el SDK…");
await page
	.waitForFunction(() => "__SENTRY__" in globalThis, { timeout: TIMEOUT })
	.then(() => console.log("  SDK presente en la página"))
	.catch(() => console.log("  AVISO: no se detectó __SENTRY__"));

// El error tiene que nacer **dentro** del bundle para que haya algo que
// simbolicar. Invocar `render` con un `this` vacío revienta en nuestro código;
// el setTimeout lo convierte en un error no capturado, que es lo que el SDK
// recoge (lo que se escribe en la consola de DevTools, no).
console.log("Provocando un error dentro del bundle…");
await page.evaluate(() => {
	setTimeout(() => {
		const Card = customElements.get("planu-login-view");
		Card.prototype.render.call({});
	}, 0);
});

await page.waitForTimeout(6000);
await browser.close();

// ── Resultados ────────────────────────────────────────────────────────────
console.log(`\nEnvelopes enviados a Sentry: ${envelopes.length}`);

if (envelopes.length === 0) {
	console.log("\nFALLO: no salió ninguna petición hacia Sentry.");
	console.log("Errores de consola observados:", consoleErrors.slice(0, 5));
	process.exit(1);
}

let ok = true;
for (const [i, e] of envelopes.entries()) {
	console.log(`\n── envelope ${i + 1} ──`);
	console.log(`  host: ${new URL(e.url).host}`);

	// Un envelope son líneas JSON: cabecera, cabecera de item, y el evento.
	const evento = e.body
		.split("\n")
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.find((o) => o?.exception ?? o?.message);

	if (!evento) {
		console.log("  (sin evento de error legible en el cuerpo)");
		continue;
	}

	const valor = evento.exception?.values?.[0];
	console.log(`  tipo:    ${valor?.type ?? "?"}`);
	console.log(`  mensaje: ${valor?.value ?? "?"}`);
	console.log(`  release: ${evento.release ?? "(ninguna) ← problema"}`);

	const marcos = valor?.stacktrace?.frames ?? [];
	const nuestros = marcos.filter((f) =>
		String(f.filename ?? "").includes("/assets/"),
	);
	console.log(
		`  marcos totales: ${marcos.length}, de nuestro bundle: ${nuestros.length}`,
	);
	for (const f of nuestros.slice(-3)) {
		console.log(
			`    ${f.filename?.split("/").pop()}:${f.lineno}:${f.colno} → ${f.function ?? "?"}`,
		);
	}

	// Los debug IDs son lo que empareja bundle y source map en Sentry.
	const debugIds = evento.debug_meta?.images?.length ?? 0;
	console.log(`  imágenes en debug_meta (debug IDs): ${debugIds}`);

	if (!evento.release) ok = false;
	if (nuestros.length === 0) {
		console.log(
			"  ← el stack no referencia nuestro bundle: no habrá nada que simbolicar",
		);
		ok = false;
	}
	if (debugIds === 0) {
		console.log("  ← sin debug IDs: los source maps subidos no se aplicarán");
		ok = false;
	}
}

console.log(
	ok
		? "\nOK: el evento sale con release, marcos de nuestro bundle y debug IDs."
		: "\nFALLO: falta algo necesario para que la traza salga legible.",
);
process.exit(ok ? 0 : 1);
