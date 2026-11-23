import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Contract of og.png without a browser: the committed file has the size the
 * Open Graph tags declare, stays light, and the script that regenerates it
 * writes exactly that path.
 */
const root = (path: string) =>
	fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const OG = root("apps/web/public/assets/landing/og.png");
const MAX_BYTES = 100 * 1024;

describe("og.png", () => {
	test("is a 1200 x 630 PNG (IHDR)", () => {
		const header = readFileSync(OG).subarray(0, 24);
		expect(header.subarray(1, 4).toString("latin1")).toBe("PNG");
		expect(header.subarray(12, 16).toString("latin1")).toBe("IHDR");
		expect(header.readUInt32BE(16)).toBe(1200);
		expect(header.readUInt32BE(20)).toBe(630);
	});

	test("weighs under 100 KB", () => {
		expect(statSync(OG).size).toBeLessThan(MAX_BYTES);
	});

	test("the generator writes that file at that size", () => {
		const script = readFileSync(root("scripts/generate-og.js"), "utf8");
		expect(script).toContain("assets/landing/og.png");
		expect(script).toMatch(/width: 1200, height: 630/);
	});

	test("landing and build point at the generated file and size", () => {
		const landing = readFileSync(
			root("apps/web/src/ui/landing/landing.ts"),
			"utf8",
		);
		expect(landing).toContain("/assets/landing/og.png");
		expect(landing).toContain('OG_IMAGE_WIDTH = "1200"');
		expect(landing).toContain('OG_IMAGE_HEIGHT = "630"');
		expect(readFileSync(root("scripts/build-landing.js"), "utf8")).toContain(
			"apps/web/public/assets/landing",
		);
	});
});
