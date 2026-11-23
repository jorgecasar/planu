import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast.js";

describe("contrast", () => {
	it("black on white is 21:1 in both directions", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
		expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
	});

	it("a colour against itself is 1:1", () => {
		expect(contrastRatio("#3f51b5", "#3F51B5")).toBeCloseTo(1, 5);
	});

	it("matches the known value for white on #767676 (4.54:1)", () => {
		expect(contrastRatio("#ffffff", "#767676")).toBeCloseTo(4.54, 2);
	});

	it("computes luminance of the extremes", () => {
		expect(relativeLuminance("#000000")).toBe(0);
		expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
	});

	it("rejects anything that is not #rrggbb", () => {
		expect(() => relativeLuminance("red")).toThrow();
		expect(() => relativeLuminance("#fff")).toThrow();
	});
});
