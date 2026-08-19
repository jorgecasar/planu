/**
 * Que la interfaz esté entera en español, y que lo publicado lo esté también.
 *
 * `npm run localize:extract` añade las unidades nuevas **sin traducir**, y
 * `localize:build` las publica igual, sin quejarse: un mensaje sin `<target>`
 * sale en inglés en medio de una pantalla en español y no lo detecta nada.
 * Pasó con seis mensajes seguidos, y quien lo vio fue una persona usando la
 * aplicación.
 *
 * Corre en Node junto a los tests de frontera: sólo lee ficheros.
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

/** Cada unidad, con su fuente y lo que haya —o no— de traducción. */
function units(): { id: string; source: string; target: string | null }[] {
	return [
		...xliff.matchAll(/<trans-unit id="([^"]+)">([\s\S]*?)<\/trans-unit>/g),
	].map(([, id, body = ""]) => {
		// El contenido se toma en crudo: un `<target>` que empieza por un
		// marcador `<x id="0"/>` tiene su texto fuera del nodo, y un parseo
		// ingenuo lo daría por vacío. Ese error dio tres falsos positivos.
		const source = /<source>([\s\S]*?)<\/source>/.exec(body)?.[1] ?? "";
		const target = /<target>([\s\S]*?)<\/target>/.exec(body)?.[1] ?? null;
		return { id: id ?? "", source, target };
	});
}

/** Las entidades que el xliff escapa y el bundle no. */
function decode(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Los fuentes donde puede haber un `msg()`, sin tests ni generados. */
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
	// Si el fichero se moviera o quedara vacío, el test de arriba pasaría solo.
	expect(units().length).toBeGreaterThan(150);
});

test("lo generado dice lo mismo que el xliff, no sólo que conoce el id", () => {
	// `localize:build` es un paso manual, y comprobar sólo el identificador no
	// bastaba: el id es un hash del **inglés**, así que editar un `<target>` y
	// olvidarse de construir dejaba el test en verde con el bundle anterior.
	// También se comprobaban antes sólo los mensajes sin marcadores, que son
	// justo los catorce más delicados los que quedaban fuera.
	const desfasadas = units()
		.filter(({ target }) => target !== null)
		.filter(({ id, target }) => {
			// En el xliff los huecos son `<x id="0"/>`; en el bundle, `${0}`.
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
	// El hueco de la familia: si alguien añade un `msg()` y no ejecuta
	// `localize:extract`, no hay unidad que traducir, no falta ningún target y
	// la cadena sale en inglés en una pantalla en español. Los otros tres tests
	// dan por hecho que el xliff está al día; éste lo comprueba.
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
