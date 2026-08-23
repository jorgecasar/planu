/**
 * Watches that Playwright never retries e2e tests under CI.
 *
 * A test that fails and passes on retry counts as *flaky* to Playwright, not
 * *failed*, and the process exits 0. `.github/workflows/ci.yml` only checks
 * that exit code, so a "green" pipeline used to mean "every test passed,
 * eventually, in up to three tries" — not "every test passed". Verified
 * against real run `32602746219` (push to `main` after T40, 22/08/2026): 10
 * of 83 e2e failed on their first attempt and passed on retry, and the job
 * still reported success. See docs/spec-ci-e2e-reliability.md.
 *
 * Runs in Node alongside the boundary tests: it only reads files.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONFIGS = ["playwright.config.ts", "playwright.landing.config.ts"];

describe.each(CONFIGS)("%s", (nombre) => {
	const fuente = readFileSync(resolve(raiz, nombre), "utf8");

	test("sets retries to a literal 0", () => {
		expect(fuente).toMatch(/\bretries:\s*0\b/);
	});

	test("does not condition retries on CI", () => {
		// The exact regression this guards against:
		// `retries: process.env["CI"] ? 2 : 0`. Under CI, that gave every e2e
		// test two more silent attempts to pass before the job noticed.
		expect(fuente).not.toMatch(/retries:\s*process\.env/);
	});
});
