/**
 * Watches that `lint:lit` can actually fail.
 *
 * `lit-analyzer` exits 0 as long as there are zero *errors*, regardless of
 * how many *warnings* it reports — confirmed empirically: a real warning
 * sat in `landing/legal.ts` for weeks, CI's "Calidad estática" step ran
 * `lit-analyzer src` every time, and it never once turned the job red. That
 * is the exact "test that can't fail" pattern AGENTS.md (sección
 * «Verificar de verdad», punto 2) already calls worse than no test at all —
 * found here, not in the e2e suite this time.
 *
 * `--maxWarnings 0` makes warnings fail too. This watches that the flag
 * stays on the script, the same way `ci-retries.test.ts` watches Playwright's
 * retry policy.
 *
 * Runs in Node alongside the other arch tests: it only reads a file.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("apps/web/package.json's lint:lit script fails on warnings, not just errors", () => {
	const pkg = JSON.parse(
		readFileSync(resolve(raiz, "package.json"), "utf8"),
	) as {
		scripts?: Record<string, string>;
	};
	const script = pkg.scripts?.["lint:lit"] ?? "";

	expect(script).toContain("lit-analyzer");
	expect(script).toMatch(/--maxWarnings\s+0\b/);
});
