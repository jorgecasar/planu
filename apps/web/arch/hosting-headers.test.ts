import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Watches the hosting configuration in `firebase.json`: CSP, security
 * headers, caching and what gets published.
 *
 * The e2e suites run against `npm run dev` or `scripts/serve-dist.js`, and
 * neither of them serves these headers, so until now nothing failed if
 * someone loosened the CSP or dropped `frame-ancestors`. This reads the file
 * that `firebase deploy` reads; it cannot tell whether production actually
 * serves it, only that what we ask Hosting to serve has not regressed.
 *
 * Runs in Node with no emulators: it only reads files.
 */

const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));

type Header = { key: string; value: string };
type Hosting = {
	public: string;
	ignore: string[];
	predeploy: string[];
	headers: { source: string; headers: Header[] }[];
};

const hosting = (
	JSON.parse(readFileSync(join(RAIZ, "firebase.json"), "utf8")) as {
		hosting: Hosting;
	}
).hosting;

function headersFor(source: string): Map<string, string> {
	const bloque = hosting.headers.find((h) => h.source === source);
	return new Map((bloque?.headers ?? []).map((h) => [h.key, h.value]));
}

const global = headersFor("**");

function csp(): Map<string, string[]> {
	const valor = global.get("Content-Security-Policy") ?? "";
	return new Map(
		valor
			.split(";")
			.map((d) => d.trim().split(/\s+/))
			.filter(([nombre]) => nombre)
			.map(([nombre, ...fuentes]) => [nombre as string, fuentes]),
	);
}

describe("Content-Security-Policy", () => {
	const directivas = csp();

	test("is set for every path", () => {
		expect(global.has("Content-Security-Policy")).toBe(true);
	});

	test("default-src is 'self'", () => {
		expect(directivas.get("default-src")).toEqual(["'self'"]);
	});

	test("script-src allows neither inline code, eval nor any https origin", () => {
		const fuentes = directivas.get("script-src") ?? [];
		expect(fuentes).toContain("'self'");
		for (const prohibida of [
			"'unsafe-inline'",
			"'unsafe-eval'",
			"https:",
			"http:",
			"*",
			"data:",
		]) {
			expect(fuentes).not.toContain(prohibida);
		}
	});

	test("object-src is 'none'", () => {
		expect(directivas.get("object-src")).toEqual(["'none'"]);
	});

	test("frame-ancestors is 'none'", () => {
		expect(directivas.get("frame-ancestors")).toEqual(["'none'"]);
	});

	test("base-uri and form-action are 'self'", () => {
		expect(directivas.get("base-uri")).toEqual(["'self'"]);
		expect(directivas.get("form-action")).toEqual(["'self'"]);
	});
});

describe("security headers", () => {
	test("X-Frame-Options is DENY", () => {
		expect(global.get("X-Frame-Options")).toBe("DENY");
	});

	test("Referrer-Policy does not leak full URLs cross-origin", () => {
		expect(global.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin",
		);
	});

	test("Permissions-Policy denies geolocation, camera and microphone", () => {
		const valor = global.get("Permissions-Policy") ?? "";
		for (const permiso of ["geolocation=()", "camera=()", "microphone=()"]) {
			expect(valor).toContain(permiso);
		}
	});
});

describe("publishing", () => {
	test("source maps are never published", () => {
		// They are uploaded to Sentry instead; serving them would hand out the
		// original source.
		expect(hosting.ignore).toContain("**/*.map");
	});

	test("hashed assets are immutable, everything else revalidates", () => {
		expect(headersFor("/assets/**").get("Cache-Control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(global.get("Cache-Control")).toBe("no-cache");
	});

	test("publishes dist/, built with the landing", () => {
		// `apps/web/dist` would deploy the app without the landing page.
		expect(hosting.public).toBe("dist");
		expect(hosting.predeploy).toEqual(["npm run build:landing"]);
	});
});
