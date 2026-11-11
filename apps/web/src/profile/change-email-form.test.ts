import { afterEach, expect, test, vi } from "vitest";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import "./change-email-form.js";

// "exmaple" on purpose: the mistyped sign-up address this form exists to fix.
const USER = { uid: "u1", email: "a@exmaple.com" } as SessionUser;

afterEach(() => {
	document.body.replaceChildren();
});

async function mount(session: Partial<SessionPort> = {}) {
	const el = document.createElement("planu-change-email-form");
	Object.assign(el, { user: USER, session });
	document.body.append(el);
	await el.updateComplete;
	return el;
}

test("sin sombra propia, con la región viva vacía desde el principio", async () => {
	const el = await mount();
	// Light DOM: the profile's shadow root keeps the markup and the focus.
	expect(el.shadowRoot).toBeNull();
	const status = el.querySelector('[role="status"]');
	expect(status?.textContent?.trim()).toBe("");
	expect(status?.hasAttribute("tabindex")).toBe(false);
});

test("envía por el puerto que recibe, lo anuncia y enfoca el reintento", async () => {
	const changeEmail = vi.fn().mockResolvedValue(undefined);
	const el = await mount({
		refreshEmailVerification: vi.fn().mockResolvedValue(USER),
		changeEmail,
	});
	el.querySelector<HTMLElement>(".change-email-open")?.click();
	await el.updateComplete;
	const input = el.querySelector<HTMLInputElement>("wa-input");
	if (!input) throw new Error("No new-email field");
	input.value = "a@example.com";
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
	el.querySelector("form")?.requestSubmit();

	await vi.waitFor(() =>
		expect(document.activeElement).toBe(
			el.querySelector(".change-email-retry"),
		),
	);
	expect(changeEmail).toHaveBeenCalledWith("a@example.com");
	expect(el.querySelector('[role="status"]')?.textContent).toContain(
		"a@example.com",
	);

	el.querySelector<HTMLElement>(".change-email-retry")?.click();
	await el.updateComplete;
	expect(el.querySelector<HTMLInputElement>("wa-input")?.value).toBe("");
});

test("un error no sobrevive a cancelar y volver a abrir", async () => {
	const el = await mount({
		refreshEmailVerification: vi.fn().mockResolvedValue(USER),
		changeEmail: vi.fn().mockRejectedValue(new Error("network")),
	});
	el.querySelector<HTMLElement>(".change-email-open")?.click();
	await el.updateComplete;
	const input = el.querySelector<HTMLInputElement>("wa-input");
	if (!input) throw new Error("No new-email field");
	input.value = "a@example.com";
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
	el.querySelector("form")?.requestSubmit();
	await vi.waitFor(() =>
		expect(el.querySelector('[role="alert"]')).not.toBeNull(),
	);

	[...el.querySelectorAll<HTMLElement>("wa-button")]
		.find((b) => b.textContent?.trim() === "Cancel")
		?.click();
	await el.updateComplete;
	el.querySelector<HTMLElement>(".change-email-open")?.click();
	await el.updateComplete;
	expect(el.querySelector('[role="alert"]')).toBeNull();
});
