import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Vigila el trinquete que aísla Firebase, definido en `biome.json`.
 *
 * Biome comprueba que nadie importe `firebase/**` fuera de la lista de
 * exenciones. Lo que **no** comprueba es que esa lista esté apretada: una
 * entrada de más deja una zona franca y el lint sigue en verde. Ya pasó — un
 * comodín `sharing/**` eximía tres ficheros que no importaban Firebase, uno de
 * ellos un módulo de política sin dependencias, y sólo lo vio una revisión
 * humana.
 *
 * Corre en Node y sin emuladores: sólo lee ficheros.
 */

const RAIZ = resolve(import.meta.dirname, "../../..");
const SRC = join(RAIZ, "apps/web/src");

/** Los `includes` del segundo override de biome.json: las exenciones. */
function exenciones(): string[] {
	const config = JSON.parse(readFileSync(join(RAIZ, "biome.json"), "utf8")) as {
		overrides: { includes: string[] }[];
	};
	const lista = config.overrides.at(-1)?.includes;
	if (!lista) throw new Error("no encuentro el override de exenciones");
	return lista;
}

/** Todos los .ts bajo un directorio, en rutas relativas a la raíz del repo. */
function ficherosBajo(dir: string): string[] {
	const salida: string[] = [];
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) salida.push(...ficherosBajo(ruta));
		else if (ruta.endsWith(".ts")) salida.push(relative(RAIZ, ruta));
	}
	return salida;
}

/**
 * Qué ficheros cubre un patrón. Sólo se admiten dos formas —ruta exacta y
 * `directorio/**`— a propósito: un comodín más expresivo es más difícil de
 * auditar de un vistazo, que es justo lo que esta lista necesita.
 */
function cubiertos(patron: string, todos: string[]): string[] {
	if (patron.endsWith("/**")) {
		const prefijo = patron.slice(0, -2);
		return todos.filter((f) => f.startsWith(prefijo));
	}
	return todos.filter((f) => f === patron);
}

const importaFirebase = (fichero: string): boolean =>
	/from\s+"firebase\/|import\("firebase\//.test(
		readFileSync(join(RAIZ, fichero), "utf8"),
	);

const TODOS = ficherosBajo(SRC);
const LISTA = exenciones();

describe("la lista de exenciones de Firebase", () => {
	test("no exime ningún fichero que no importe Firebase", () => {
		const sobrantes = LISTA.flatMap((patron) =>
			cubiertos(patron, TODOS).filter((f) => !importaFirebase(f)),
		);

		// Un fichero eximido sin necesidad es una zona franca: mañana alguien
		// añade Firebase ahí y nada se queja.
		expect(sobrantes).toEqual([]);
	});

	test("no tiene entradas muertas", () => {
		const vacias = LISTA.filter((p) => cubiertos(p, TODOS).length === 0);

		// Una ruta que no casa con nada suele ser un fichero renombrado, y deja
		// la lista contando exenciones que ya no existen.
		expect(vacias).toEqual([]);
	});

	test("cubre todo lo que hoy importa Firebase", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		const sinEximir = TODOS.filter(
			(f) => importaFirebase(f) && !eximidos.has(f),
		);

		// Esto lo detectaría también el lint; aquí el mensaje dice cuáles son.
		expect(sinEximir).toEqual([]);
	});

	test("sólo usa rutas exactas o `directorio/**`", () => {
		const raros = LISTA.filter((p) => p.includes("*") && !p.endsWith("/**"));

		expect(raros).toEqual([]);
	});
});
