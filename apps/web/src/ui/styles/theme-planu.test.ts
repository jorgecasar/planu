// Same sheets `main.ts` loads. Without `theme-planu.css` the probes resolve to
// the Web Awesome defaults, so every assertion here fails on its own.
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "./theme-planu.css";
import { afterEach, beforeEach, expect, test } from "vitest";

let probe: HTMLElement;

beforeEach(() => {
	probe = document.createElement("div");
	document.body.append(probe);
});

afterEach(() => {
	probe.remove();
	document.documentElement.classList.remove(
		"wa-theme-planu",
		"wa-light",
		"wa-dark",
	);
});

function token(name: string): string {
	return getComputedStyle(probe).getPropertyValue(name).trim();
}

function themed(...classes: string[]): void {
	document.documentElement.classList.add("wa-theme-planu", ...classes);
}

test("light: brand fill and heading font come from the planu theme", () => {
	themed("wa-light");
	expect(token("--wa-color-brand-fill-loud")).toBe("#3f51b5");
	expect(token("--wa-font-family-heading")).toMatch(/^"?Belleza"?,/);
	expect(token("--wa-font-family-body")).toMatch(/^"?Alegreya"?,/);
	probe.style.color = "var(--wa-color-brand-fill-loud)";
	expect(getComputedStyle(probe).color).toBe("rgb(63, 81, 181)");
});

test("dark: the AA-checked brand values win over the light ones", () => {
	themed("wa-dark");
	expect(token("--wa-color-brand-fill-loud")).toBe("#5c6bc0");
	expect(token("--wa-color-brand-fill-quiet")).toBe("#283593");
	expect(token("--wa-color-brand-on-quiet")).toBe("#e8eaf6");
});

test("the scales are the planu ones", () => {
	themed("wa-light");
	expect(token("--wa-space-scale")).toBe("1.125");
	expect(token("--wa-border-radius-scale")).toBe("1.25");
});
