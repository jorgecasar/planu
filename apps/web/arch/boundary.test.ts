import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Watches the ratchet that isolates Firebase, defined in `biome.json`.
 *
 * Biome checks that nobody imports `firebase/**` outside the exemption
 * list. What it does **not** check is that that list stays tight: one
 * extra entry leaves a free zone and the lint stays green. It has already
 * happened — a `sharing/**` wildcard exempted three files that did not
 * import Firebase, one of them a dependency-free policy module, and only a
 * review caught it.
 *
 * And it watches the gate, not just the list: deleting the override that
 * **enforces** the rule left the four assertions green and the lint clean.
 * That was also found by a review, not by this file.
 *
 * Runs in Node with no emulators: it only reads files.
 */

// `fileURLToPath` and not `import.meta.dirname`, which requires Node ≥20.11
// while `engines` declares `>=20`.
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

/** The one that forbids. Found by shape, not by position. */
const imponen = () => overrides().filter((o) => typeof regla(o) === "object");
/** The one that exempts. Same idea. */
const eximen = () => overrides().filter((o) => regla(o) === "off");

/** Every .ts under a directory, as paths relative to the repo root. */
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
 * Which files a pattern covers. Only two shapes are allowed — an exact path
 * and `directorio/**` — on purpose: a more expressive wildcard is harder to
 * audit at a glance, and the "only exact paths or directorio/**" assertion
 * is what keeps a shape that Biome understands and this does not from
 * sneaking in here.
 */
function cubiertos(patron: string, todos: string[]): string[] {
	if (patron.endsWith("/**")) {
		const prefijo = patron.slice(0, -2);
		return todos.filter((f) => f.startsWith(prefijo));
	}
	return todos.filter((f) => f === patron);
}

/**
 * The five shapes Biome flags: static, `import type`, `export … from`,
 * dynamic — even split across several lines — and side-effect, plus the
 * bare `firebase` root package with no slash.
 */
const importaFirebase = (fichero: string): boolean =>
	/(?:from|import)\s*\(?\s*["']firebase(?:\/|["'])/.test(
		readFileSync(join(RAIZ, fichero), "utf8"),
	);

/**
 * Files coupled today. **Can only go down.** Raising it means coupling more
 * code to Firebase, and that gets discussed in a review instead of
 * sneaking into a diff. It counts files, not list entries.
 *
 * T36 brought it down from 23 to 19: it freed six —`app-shell.ts`,
 * `login-view.ts`, `guard.ts` and `guard.test.ts`, and `auth-errors.ts` with
 * its test, moved to `domain/`— and added two new ones under
 * `infrastructure/firebase/**`, the migration's first adapter.
 * `profile-view.ts` stays on the list: it no longer imports `firebase/auth`,
 * but it still keeps `firebase/firestore` to publish to the user directory,
 * and that's Firestore — T37's port, not the session one.
 *
 * T31 raised it from 19 to 21, with nothing freed this time: `analytics/`
 * had no `firebase/*` import to begin with —the whole point was giving it
 * `AnalyticsPort` and never a Firebase type— so the two new files are
 * `infrastructure/firebase/analytics-adapter.ts` and its test, the
 * migration's second adapter. Same shape as T36's raise, and the same
 * reason it is not a workaround: the count only ever grows here on purpose,
 * inside the one place `firebase/*` is meant to live, never by adding an
 * exemption elsewhere to dodge the count.
 */
const TOPE_ACOPLADOS = 21;

const TODOS = ficherosBajo(SRC);
const LISTA = eximen().flatMap((o) => o.includes);

describe("la frontera de Firebase", () => {
	test("biome.json conserva un override que impone y otro que exime", () => {
		// Without this, deleting the one that enforces leaves the rest of the
		// assertions green and the lint clean: the watcher would be guarding
		// the list and not the gate.
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
		// Bare `firebase` in addition to `firebase/**`: the root package can
		// also be imported.
		expect(grupo).toContain("firebase/**");
		expect(grupo).toContain("firebase");
	});
});

describe("la lista de exenciones", () => {
	test("no exime ningún fichero que no importe Firebase", () => {
		const sobrantes = LISTA.flatMap((patron) =>
			cubiertos(patron, TODOS).filter((f) => !importaFirebase(f)),
		);

		// A file exempted with no need for it is a free zone: tomorrow
		// someone adds Firebase there and nothing complains.
		expect(sobrantes).toEqual([]);
	});

	test("no tiene entradas muertas", () => {
		const vacias = LISTA.filter((p) => cubiertos(p, TODOS).length === 0);

		// A path that matches nothing is usually a renamed file, and leaves
		// the list counting exemptions that no longer exist.
		expect(vacias).toEqual([]);
	});

	test("cubre todo lo que hoy importa Firebase", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		const sinEximir = TODOS.filter(
			(f) => importaFirebase(f) && !eximidos.has(f),
		);

		// The lint would also catch this; here the message says which ones
		// they are.
		expect(sinEximir).toEqual([]);
	});

	test("no crece", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		expect(eximidos.size).toBeLessThanOrEqual(TOPE_ACOPLADOS);
	});

	test("sólo usa rutas exactas o `directorio/**`", () => {
		// The negation reads as "narrow down" but to Biome means "exclude", so
		// it is rejected separately so the message does not lie.
		expect(LISTA.filter((p) => p.startsWith("!"))).toEqual([]);
		expect(LISTA.filter((p) => p.includes("*") && !p.endsWith("/**"))).toEqual(
			[],
		);
	});
});
