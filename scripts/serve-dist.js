#!/usr/bin/env node

/**
 * Servidor estático sobre `dist/`, para revisar o probar la landing tal como se
 * publica.
 *
 * Existe porque `npm run dev` **no sirve la landing**: la genera
 * `build:landing` con `@lit-labs/ssr` y sale a `dist/`. Probarla contra el
 * servidor de desarrollo comprobaría otra página.
 *
 * Deliberadamente **sin fallback a `index.html`**: la landing es multipágina y
 * un fallback haría responder 200 a cualquier ruta inexistente —incluidas las
 * que el `hreflang` promete—, que es lo que los e2e vienen a comprobar.
 *
 *   node scripts/serve-dist.js [puerto]
 */

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), "dist");
const PORT = Number(process.argv[2] ?? process.env["LANDING_PORT"] ?? 4173);

const TYPES = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".xml": "application/xml; charset=utf-8",
};

/** Las rutas de la aplicación las resuelve su propio HTML, como el rewrite. */
function isAppRoute(path) {
	return path === "/app" || path.startsWith("/app/");
}

async function resolveTarget(path) {
	if (isAppRoute(path)) return join(ROOT, "app.html");

	// `normalize` colapsa los `..`, así que un path traversal no sale de ROOT.
	let target = join(ROOT, normalize(path));
	try {
		if ((await stat(target)).isDirectory()) target = join(target, "index.html");
	} catch {
		return null;
	}
	return target;
}

createServer(async (request, response) => {
	const [path = "/"] = (request.url ?? "/").split("?");
	const target = await resolveTarget(path);

	if (target === null) {
		response.writeHead(404, { "content-type": "text/plain" }).end("404");
		return;
	}

	try {
		const body = await readFile(target);
		response.writeHead(200, {
			"content-type": TYPES[extname(target)] ?? "application/octet-stream",
		});
		response.end(body);
	} catch {
		response.writeHead(404, { "content-type": "text/plain" }).end("404");
	}
}).listen(PORT, () => {
	console.log(`Sirviendo dist/ en http://localhost:${PORT}`);
});
