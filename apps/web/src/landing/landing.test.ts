import { render } from "lit";
import { describe, expect, it } from "vitest";
import { header, hero } from "./landing.js";

function mount(template: ReturnType<typeof hero>): HTMLElement {
	const host = document.createElement("div");
	render(template, host);
	return host;
}

describe("landing hero and header", () => {
	it("has exactly one primary action, to the sign-in page", () => {
		const host = mount(hero());
		const primary = host.querySelectorAll("a.wa-button.wa-brand");

		expect(primary).toHaveLength(1);
		expect(primary[0]?.textContent?.trim()).toBe("Create your account");
		expect(primary[0]?.getAttribute("href")).toBe("/app/login");
	});

	it("does not offer the retired 'Start planning' action", () => {
		const host = mount(hero());

		expect(host.textContent).not.toContain("Start planning");
		expect(host.querySelector('a[href="/app"]')).toBeNull();
	});

	it("states the category and the privacy promise in the h1", () => {
		const host = mount(hero());

		expect(host.querySelector("h1")?.textContent?.trim()).toBe(
			"Plan your events. Share them only with the people you choose.",
		);
	});

	it("claims nothing about price or ads", () => {
		const text = mount(hero()).textContent ?? "";

		expect(text).not.toMatch(/\bfree\b|\bno ads\b|gratis|sin anuncios/i);
	});

	it("puts 'Sign in' in the header as a plain link, not a second primary", () => {
		const host = mount(header());
		const signIn = host.querySelector("a.wa-button");

		expect(signIn?.textContent?.trim()).toBe("Sign in");
		expect(signIn?.getAttribute("href")).toBe("/app/login");
		expect(signIn?.classList.contains("wa-plain")).toBe(true);
		expect(signIn?.classList.contains("wa-brand")).toBe(false);
	});
});
