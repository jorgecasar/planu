// The theme, as `main.ts` loads it: without it axe cannot compute contrast
// and "no violations" would mean "could not check".
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import axe from "axe-core";
import { html, render } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { fileButtonStyles, renderFileButton } from "./file-button.js";

/** The picker inside a shadow root, with a field before it to tab from. */
async function mount(disabled = false, onChange = vi.fn()) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = host.attachShadow({ mode: "open" });
	root.adoptedStyleSheets = [fileButtonStyles.styleSheet as CSSStyleSheet];
	render(
		html`<input aria-label="Before" />
			<label for="pick">Event image</label>
			${renderFileButton({ id: "pick", accept: "image/png", disabled, onChange })}
			<input aria-label="After" />`,
		root,
	);
	const button = root.querySelector<
		HTMLElement & { updateComplete: Promise<boolean> }
	>(".file-button");
	await button?.updateComplete;
	const input = root.querySelector<HTMLInputElement>("#pick");
	if (!button || !input) throw new Error("not rendered");
	return { root, input, button, onChange };
}

afterEach(() => {
	document.body.replaceChildren();
});

test("the native input keeps its label and is hidden only from sight", async () => {
	const { input, button } = await mount();
	expect(input.labels?.[0]?.textContent).toBe("Event image");
	expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(1);
	expect(button.getBoundingClientRect().width).toBeGreaterThan(1);
	expect(button.textContent?.trim()).toBe("Choose image");
});

test("the button opens the picker and the change reaches the caller", async () => {
	const { input, button, onChange } = await mount();
	const opened = vi.fn();
	input.addEventListener("click", opened);
	button.click();
	expect(opened).toHaveBeenCalledOnce();
	input.dispatchEvent(new Event("change"));
	expect(onChange).toHaveBeenCalledOnce();
});

test("one tab stop: the keyboard lands on the input and skips the button", async () => {
	const { root, input } = await mount();
	root.querySelector<HTMLInputElement>('[aria-label="Before"]')?.focus();
	await userEvent.tab();
	expect(root.activeElement).toBe(input);
	await userEvent.tab();
	expect(root.activeElement?.getAttribute("aria-label")).toBe("After");
});

test("keyboard focus on the input draws the focus ring on the button", async () => {
	const { root, button } = await mount();
	const face = button.shadowRoot?.querySelector('[part~="button"]');
	if (!face) throw new Error("no button part");
	expect(getComputedStyle(face).outlineStyle).toBe("none");
	root.querySelector<HTMLInputElement>('[aria-label="Before"]')?.focus();
	await userEvent.tab();
	expect(getComputedStyle(face).outlineStyle).not.toBe("none");
});

test("disabled reaches both the input and the button", async () => {
	const { input, button } = await mount(true);
	expect(input.disabled).toBe(true);
	expect(button.hasAttribute("disabled")).toBe(true);
});

test("axe finds no violations", async () => {
	const { root } = await mount();
	const results = await axe.run(root.host as HTMLElement);
	expect(results.violations).toEqual([]);
});
