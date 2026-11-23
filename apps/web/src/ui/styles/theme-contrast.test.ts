import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../domain/contrast.js";
import themeCss from "./theme-planu.css?raw";

const AA_TEXT = 4.5;
const AA_UI = 3;

/** Reads the `--wa-color-brand-*` tokens of the rule whose selector list contains `marker`. */
function brandTokens(marker: string): Record<string, string> {
	const rule = themeCss
		.split("}")
		.find((chunk) => chunk.slice(0, chunk.lastIndexOf("{")).includes(marker));
	if (!rule) {
		throw new Error(`No rule for ${marker} in theme-planu.css`);
	}
	const tokens: Record<string, string> = {};
	for (const m of rule.matchAll(
		/--wa-color-brand-([a-z-]+):\s*(#[0-9a-f]{6});/gi,
	)) {
		const [, name, value] = m;
		if (name && value) {
			tokens[name] = value;
		}
	}
	return tokens;
}

const modes = [
	["light", ".wa-theme-planu.wa-light"],
	["dark", ".wa-theme-planu.wa-dark"],
] as const;

describe.each(modes)("planu %s theme contrast", (_mode, marker) => {
	const t = brandTokens(marker);
	const pair = (a: string, b: string): number => {
		const fg = t[a];
		const bg = t[b];
		if (!fg || !bg) {
			throw new Error(`Missing token ${a} or ${b}`);
		}
		return contrastRatio(fg, bg);
	};

	it.each([
		["on-loud", "fill-loud"],
		["on-loud", "fill-normal"],
		["on-quiet", "fill-quiet"],
	])("text %s on %s reaches 4.5:1", (fg, bg) => {
		expect(pair(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
	});

	it("border-loud against fill-quiet reaches 3:1 (non-text UI)", () => {
		expect(pair("border-loud", "fill-quiet")).toBeGreaterThanOrEqual(AA_UI);
	});
});
