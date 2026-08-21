/**
 * That the interface is entirely in Spanish, and that what is published is
 * too.
 *
 * `npm run localize:extract` adds new units **untranslated**, and
 * `localize:build` publishes them just the same, with no complaint: a
 * message with no `<target>` shows up in English in the middle of a Spanish
 * screen and nothing detects it. It happened with six messages in a row,
 * and the one who spotted it was a person using the application.
 *
 * Runs in Node alongside the boundary tests: it only reads files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const xliff = readFileSync(resolve(raiz, "xliff/es.xlf"), "utf8");
const generado = readFileSync(
	resolve(raiz, "src/generated/locales/es.js"),
	"utf8",
);

/** Each unit, with its source and whatever translation it has — or does not. */
function units(): { id: string; source: string; target: string | null }[] {
	return [
		...xliff.matchAll(/<trans-unit id="([^"]+)">([\s\S]*?)<\/trans-unit>/g),
	].map(([, id, body = ""]) => {
		// The content is taken raw: a `<target>` that starts with an `<x
		// id="0"/>` marker has its text outside the node, and a naive parse
		// would consider it empty. That bug produced three false positives.
		const source = /<source>([\s\S]*?)<\/source>/.exec(body)?.[1] ?? "";
		const target = /<target>([\s\S]*?)<\/target>/.exec(body)?.[1] ?? null;
		return { id: id ?? "", source, target };
	});
}

/** The entities the xliff escapes and the bundle does not. */
function decode(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** The source files where a `msg()` might live, no tests and no generated files. */
function sources(): string[] {
	const encontrados: string[] = [];
	const recorrer = (dir: string) => {
		for (const entrada of readdirSync(dir, { withFileTypes: true })) {
			const ruta = resolve(dir, entrada.name);
			if (entrada.isDirectory()) {
				if (entrada.name !== "generated") recorrer(ruta);
			} else if (
				entrada.name.endsWith(".ts") &&
				!entrada.name.endsWith(".test.ts")
			) {
				encontrados.push(ruta);
			}
		}
	};
	recorrer(resolve(raiz, "src"));
	return encontrados;
}

test("no queda ningún mensaje sin traducir", () => {
	const sin = units()
		.filter(({ target }) => target === null || target.trim() === "")
		.map(({ source }) => source);

	expect(sin, `Traduce estos ${sin.length} en xliff/es.xlf`).toEqual([]);
});

test("hay mensajes de sobra como para que el test no pase por vacío", () => {
	// If the file were moved or ended up empty, the test above would pass on its own.
	expect(units().length).toBeGreaterThan(150);
});

test("lo generado dice lo mismo que el xliff, no sólo que conoce el id", () => {
	// `localize:build` is a manual step, and checking only the identifier
	// was not enough: the id is a hash of the **English**, so editing a
	// `<target>` and forgetting to build left the test green with the
	// previous bundle. It also used to check only messages with no
	// placeholders, which are exactly the fourteen trickiest ones being
	// left out.
	const desfasadas = units()
		.filter(({ target }) => target !== null)
		.filter(({ id, target }) => {
			// In the xliff the placeholders are `<x id="0"/>`; in the bundle, `${0}`.
			const esperado = decode(
				(target ?? "").replace(/<x id="(\d+)"[^>]*\/>/g, "$${$1}"),
			);
			const publicado = new RegExp(`${id}:\\s*(?:str)?\`([\\s\\S]*?)\``).exec(
				generado,
			)?.[1];
			return publicado !== esperado;
		})
		.map(({ source }) => source);

	expect(desfasadas, "Ejecuta npm run localize:build").toEqual([]);
});

test("todo msg() del código está extraído al xliff", () => {
	// The gap in the family: if someone adds a `msg()` and does not run
	// `localize:extract`, there is no unit to translate, no target is
	// missing, and the string shows up in English on a Spanish screen. The
	// other three tests take for granted that the xliff is up to date; this
	// one checks it.
	const fuentes = new Set(units().map(({ source }) => decode(source)));

	const huerfanos = sources()
		.flatMap((fichero) =>
			[
				...readFileSync(fichero, "utf8").matchAll(
					/msg\(\s*"((?:[^"\\]|\\.)*)"/g,
				),
			].map((m) => JSON.parse(`"${m[1]}"`) as string),
		)
		.filter((literal) => !fuentes.has(literal));

	expect([...new Set(huerfanos)], "Ejecuta npm run localize:extract").toEqual(
		[],
	);
});
