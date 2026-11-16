import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Watches the layer rules of docs/spec-arquitectura-hexagonal.md so they stop
 * depending on goodwill. A build that imports across a forbidden edge fails
 * here and the message names the file, the import and the rule.
 *
 *   domain          imports only `domain/` (and `zod`, `@lit/localize`)
 *   application     imports only `domain/` and `application/`
 *   infrastructure  imports no interface folder
 *   interface       imports `infrastructure/` only from `main.ts`
 *
 * The interface is "everything else" for now: the folders that are neither a
 * layer nor shared plumbing (`generated/`, `i18n/`). GH-314 narrows it to
 * `ui/`. Sources only, never `*.test.ts`. Runs in Node: it only reads files.
 */

// `fileURLToPath` and not `import.meta.dirname`, which requires Node ≥20.11
// while `engines` declares `>=20`.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const LAYERS = ["domain", "application", "infrastructure"];
const SHARED = ["generated", "i18n"];
/** Zod for the pure validation schemas, `@lit/localize` for rule messages. */
const DOMAIN_PACKAGES = ["zod", "@lit/localize"];

/** Every non-test `.ts` under a directory, relative to `src/`. */
function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sources(path);
		return path.endsWith(".ts") && !path.endsWith(".test.ts")
			? [relative(SRC, path)]
			: [];
	});
}

/**
 * The module specifiers a source imports: static, `import type`,
 * `export … from`, side-effect and dynamic, even split across lines.
 * Comments are dropped first so a sentence saying "import x from y" is no edge.
 */
function specifiers(source: string): string[] {
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	return [
		/\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
		/\bimport\s*["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	].flatMap((shape) => [...code.matchAll(shape)].map((m) => m[1] as string));
}

/** The layer (or folder) of `src/` a path relative to it lives in. */
const layerOf = (path: string) => {
	const first = path.split(sep)[0] ?? "";
	return first.endsWith(".ts") ? "root" : first;
};

type Edge = { file: string; spec: string; from: string; to: string };

/** Every import of every source; packages land in `to: "package"`. */
const EDGES: Edge[] = sources(SRC).flatMap((file) =>
	specifiers(readFileSync(join(SRC, file), "utf8")).map((spec) => ({
		file,
		spec,
		from: layerOf(file),
		to: spec.startsWith(".")
			? layerOf(relative(SRC, resolve(SRC, dirname(file), spec)))
			: "package",
	})),
);

/** The edges that break a rule, as messages naming file, import and rule. */
const broken = (rule: string, bad: (e: Edge) => boolean) =>
	EDGES.filter(bad).map(
		(e) => `${e.file} imports "${e.spec}" (${e.from} → ${e.to}): ${rule}`,
	);

describe("the layer rules hold over the sources", () => {
	test("every layer has files, or the checks below prove nothing", () => {
		for (const layer of LAYERS)
			expect(
				EDGES.filter((e) => e.from === layer).length,
				`no imports under src/${layer}/`,
			).toBeGreaterThan(0);
	});

	test("domain imports only domain", () => {
		expect(
			broken(
				"domain/ may only import domain/",
				(e) => e.from === "domain" && !["domain", "package"].includes(e.to),
			),
		).toEqual([]);
	});

	test("domain imports no package but zod and @lit/localize", () => {
		expect(
			broken(
				`domain/ may only import ${DOMAIN_PACKAGES.join(" and ")} from outside`,
				(e) =>
					e.from === "domain" &&
					e.to === "package" &&
					!DOMAIN_PACKAGES.includes(e.spec),
			),
		).toEqual([]);
	});

	test("application imports only domain and application", () => {
		expect(
			broken(
				"application/ may only import domain/ and application/",
				(e) =>
					e.from === "application" &&
					!["domain", "application", "package"].includes(e.to),
			),
		).toEqual([]);
	});

	test("infrastructure imports no interface folder", () => {
		expect(
			broken(
				"infrastructure/ may not import interface folders",
				(e) =>
					e.from === "infrastructure" &&
					![...LAYERS, ...SHARED, "package"].includes(e.to),
			),
		).toEqual([]);
	});

	test("nothing outside infrastructure and main.ts imports infrastructure", () => {
		expect(
			broken(
				"only infrastructure/ and main.ts may import infrastructure/",
				(e) =>
					e.to === "infrastructure" &&
					e.from !== "infrastructure" &&
					e.file !== "main.ts",
			),
		).toEqual([]);
	});
});

describe("the import reader sees every shape, so the rules above can fail", () => {
	test.each([
		['import { a } from "./a.js";', "./a.js"],
		['import type { A } from "../b.js";', "../b.js"],
		['export * from "./c.js";', "./c.js"],
		['export { d } from "./d.js";', "./d.js"],
		['import "./e.js";', "./e.js"],
		['const m = await import("./f.js");', "./f.js"],
		['import {\n\ta,\n\tb,\n} from "./g.js";', "./g.js"],
	])("%s", (source, expected) => {
		expect(specifiers(source)).toContain(expected);
	});

	test("a comment that mentions an import does not count", () => {
		expect(
			specifiers('// import x from "./no.js"\n/* import y from "./no2.js" */'),
		).toEqual([]);
	});
});
