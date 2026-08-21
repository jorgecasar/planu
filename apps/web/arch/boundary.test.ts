import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Vigila el trinquete que aísla Firebase, definido en `biome.json`.
 *
 * Biome comprueba que nadie importe `firebase/**` fuera de la lista de
 * exenciones. Lo que **no** comprueba es que esa lista esté apretada: una
 * entrada de más deja una zona franca y el lint sigue en verde. Ya pasó — un
 * comodín `sharing/**` eximía tres ficheros que no importaban Firebase, uno de
 * ellos un módulo de política sin dependencias, y sólo lo vio una revisión.
 *
 * Y vigila la puerta, no sólo la lista: borrar el override que **impone** la
 * regla dejaba las cuatro aserciones en verde y el lint limpio. También lo
 * encontró una revisión, no este fichero.
 *
 * Corre en Node y sin emuladores: sólo lee ficheros.
 */

// `fileURLToPath` y no `import.meta.dirname`, que exige Node ≥20.11 mientras
// `engines` declara `>=20`.
const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(RAIZ, "apps/web/src");

type Override = {
	includes: string[];
	linter?: { rules?: { style?: { noRestrictedImports?: unknown } } };
};

function overrides(): Override[] {
	const config = JSON.parse(readFileSync(join(RAIZ, "biome.json"), "utf8")) as {
		overrides?: Override[];
	};
	return config.overrides ?? [];
}

const regla = (o: Override) => o.linter?.rules?.style?.noRestrictedImports;

/** El que prohíbe. Se busca por forma, no por posición. */
const imponen = () => overrides().filter((o) => typeof regla(o) === "object");
/** El que exime. Ídem. */
const eximen = () => overrides().filter((o) => regla(o) === "off");

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
 * auditar de un vistazo, y la aserción «sólo rutas exactas o directorio/**»
 * es lo que impide que aquí se cuele una forma que Biome entienda y esto no.
 */
function cubiertos(patron: string, todos: string[]): string[] {
	if (patron.endsWith("/**")) {
		const prefijo = patron.slice(0, -2);
		return todos.filter((f) => f.startsWith(prefijo));
	}
	return todos.filter((f) => f === patron);
}

/**
 * Las cinco formas que Biome marca: estática, `import type`, `export … from`,
 * dinámica —incluso partida en varias líneas— y de efecto lateral, más el
 * paquete raíz `firebase` sin barra.
 */
const importaFirebase = (fichero: string): boolean =>
	/(?:from|import)\s*\(?\s*["']firebase(?:\/|["'])/.test(
		readFileSync(join(RAIZ, fichero), "utf8"),
	);

/**
 * Ficheros acoplados hoy. **Sólo puede bajar**, salvo que subir tenga su
 * propia justificación registrada aquí mismo: subir sin decir por qué es
 * acoplar más código a Firebase colándose en un diff, en vez de discutirse en
 * una revisión. Son ficheros y no entradas de la lista.
 *
 * T36 lo bajó de 23 a 19: liberó seis —`app-shell.ts`, `login-view.ts`,
 * `guard.ts` y `guard.test.ts`, y `auth-errors.ts` con su test, movido a
 * `domain/`— y sumó dos nuevos bajo `infrastructure/firebase/**`, el primer
 * adaptador de la migración. `profile-view.ts` sigue en la lista: ya no
 * importa `firebase/auth`, pero conserva `firebase/firestore` para publicar
 * en el directorio de usuarios, y eso es Firestore — el puerto de T37, no
 * el de sesión.
 *
 * T48 (spec de horas en eventos) lo sube de 19 a 21, y es la excepción
 * documentada. Migra `event-editor.ts` a `EventRepositoryPort` e
 * `ImageStorePort`: ya no importa `firebase/firestore` ni `firebase/storage`,
 * que es el acoplamiento que de verdad importaba —el guardado, con la
 * normalización de la decisión 5 del spec de horas—. Pero el fichero **se
 * queda en la lista** por un motivo no relacionado: `firebase/app` (el tipo
 * `FirebaseApp` que necesita para construir el modelo de IA) y el import
 * dinámico de `firebase/ai`, ambos de la sugerencia de etiquetas con IA de
 * T24 y fuera del alcance de T48. Y suman dos adaptadores nuevos bajo
 * `infrastructure/firebase/**` —`event-repository.ts`, `image-store.ts`—, que
 * sí cuentan aunque sea justo el sitio donde este acoplamiento debe vivir.
 * Resultado: sin reducción neta todavía. Sacar a `event-editor.ts` de la
 * lista por completo es trabajo de T37/T38, que cubren el mismo fichero con
 * más alcance —también `event-card.ts` y `events-view.ts`—.
 */
const TOPE_ACOPLADOS = 21;

const TODOS = ficherosBajo(SRC);
const LISTA = eximen().flatMap((o) => o.includes);

describe("la frontera de Firebase", () => {
	test("biome.json conserva un override que impone y otro que exime", () => {
		// Sin esto, borrar el que impone deja el resto de aserciones en verde
		// y el lint limpio: el vigilante guardaría la lista y no la puerta.
		expect({ imponen: imponen().length, eximen: eximen().length }).toEqual({
			imponen: 1,
			eximen: 1,
		});
	});

	test("el override que impone cubre todo src y todo el paquete firebase", () => {
		const [impone] = imponen();
		expect(impone?.includes).toEqual(["apps/web/src/**"]);

		const opciones = regla(impone as Override) as {
			options?: { patterns?: { group?: string[] }[] };
		};
		const grupo = opciones.options?.patterns?.[0]?.group ?? [];
		// `firebase` a secas además de `firebase/**`: el paquete raíz también
		// se puede importar.
		expect(grupo).toContain("firebase/**");
		expect(grupo).toContain("firebase");
	});
});

describe("la lista de exenciones", () => {
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

	test("no crece", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		expect(eximidos.size).toBeLessThanOrEqual(TOPE_ACOPLADOS);
	});

	test("sólo usa rutas exactas o `directorio/**`", () => {
		// La negación se lee como «acotar» y para Biome significa «excluir»,
		// así que se rechaza aparte para que el mensaje no mienta.
		expect(LISTA.filter((p) => p.startsWith("!"))).toEqual([]);
		expect(LISTA.filter((p) => p.includes("*") && !p.endsWith("/**"))).toEqual(
			[],
		);
	});
});
