import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * The lcov that Sonar reads must not be older than the sources it describes
 * (#244): a stale report gives a gate computed on code that no longer exists.
 * Runs on temporary files, no coverage run needed.
 */
const { checkCoverageFresh } = await import(
	new URL("../../../scripts/check-coverage-fresh.js", import.meta.url).href
);
let root: string;
const at = (file: string, seconds: number) => {
	const time = new Date(1_700_000_000_000 + seconds * 1000);
	utimesSync(file, time, time);
};
const write = (relative: string, seconds: number) => {
	const file = join(root, relative);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, "x");
	at(file, seconds);
	return file;
};
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "coverage-fresh-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const check = () =>
	checkCoverageFresh({ lcov: join(root, "lcov.info"), src: join(root, "src") });
describe("checkCoverageFresh", () => {
	test("a report newer than every source is fresh", () => {
		write("src/a.ts", 10);
		write("src/deep/b.ts", 20);
		write("lcov.info", 30);
		expect(check()).toEqual({ ok: true });
	});
	test("a missing report says which command makes it", () => {
		write("src/a.ts", 10);
		const result = check();
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("npm run test:coverage");
	});
	test("a report older than one source is stale and names that source", () => {
		write("lcov.info", 20);
		write("src/a.ts", 10);
		write("src/deep/b.ts", 40);
		const result = check();
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("deep/b.ts");
		expect(result.reason).toContain("npm run test:coverage");
	});
	test("the generated locales do not make the report stale: they are not measured", () => {
		write("lcov.info", 20);
		write("src/a.ts", 10);
		write("src/generated/locales/es.js", 90);
		expect(check()).toEqual({ ok: true });
	});
	test("a folder without sources cannot vouch for a report", () => {
		write("lcov.info", 20);
		mkdirSync(join(root, "src"));
		const result = check();
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("no sources");
	});
});
