/**
 * Comprueba lo que cuesta arrancar la aplicación, contra una URL desplegada.
 *
 * **No es un test de la suite, y no puede serlo.** Se intentó como e2e y
 * resultó vacuo: en desarrollo `connectAuthEmulator` evita que Firebase cargue
 * gapi, así que la condición se cumple sola y no detecta la regresión. Sólo
 * tiene sentido contra un bundle construido hablando con Firebase de verdad:
 * producción, o un canal de preview.
 *
 *   node scripts/check-startup-cost.mjs [url]
 *
 * Lo que defiende, medido en agosto de 2026 (ver docs/adr/0004 y el informe de
 * rendimiento): la página pasó de 390 KiB a 156 KiB. Si alguien sustituye
 * `initializeAuth` por `getAuth` en firebase-provider.ts, vuelven los 137 KiB
 * de gapi y del iframe de autenticación sin que nada más se rompa.
 */

import { chromium } from "playwright";

const TARGET = process.argv[2] ?? "https://planu-app.web.app";

/** Orígenes que no deben aparecer al arrancar, y por qué. */
const PROHIBIDOS = new Map([
	["apis.google.com", "gapi: sólo hace falta al pulsar «acceder con Google»"],
	[
		"planu-app.firebaseapp.com",
		"iframe de autenticación: ídem, 94 KiB transferidos",
	],
]);

/** Tope de peso, con margen sobre los 156 KiB medidos. */
const MAX_KIB = 220;

const navegador = await chromium.launch();
const pagina = await navegador.newPage();

const origenes = new Map();
let bytes = 0;

pagina.on("response", async (respuesta) => {
	const { host } = new URL(respuesta.url());
	origenes.set(host, (origenes.get(host) ?? 0) + 1);
	const largo = respuesta.headers()["content-length"];
	if (largo) bytes += Number(largo);
});

console.log(`Midiendo el arranque de ${TARGET}\n`);
await pagina.goto(TARGET, { waitUntil: "networkidle", timeout: 45_000 });
await pagina.waitForTimeout(3000);
await navegador.close();

console.log("orígenes contactados:");
for (const [host, n] of [...origenes].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(n).padStart(2)}× ${host}`);
}

const kib = Math.round(bytes / 1024);
console.log(`\npeso declarado por content-length: ~${kib} KiB (tope ${MAX_KIB})`);

let ok = true;
for (const [host, motivo] of PROHIBIDOS) {
	if (origenes.has(host)) {
		console.log(`\n✗ ${host} se contacta al arrancar — ${motivo}`);
		ok = false;
	}
}
if (kib > MAX_KIB) {
	console.log(`\n✗ el arranque pesa ${kib} KiB, por encima del tope`);
	ok = false;
}

console.log(ok ? "\n✓ el coste de arranque se mantiene" : "\n✗ hay regresión");
process.exit(ok ? 0 : 1);
