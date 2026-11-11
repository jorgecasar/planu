import { afterEach, expect, test, vi } from "vitest";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import "./change-email-form.js";

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

test("sin sombra propia, enfoca su campo al montarse", async () => {
	const el = await mount();
	// Light DOM: the profile's shadow root keeps the markup and the focus.
	expect(el.shadowRoot).toBeNull();
	expect(document.activeElement).toBe(el.querySelector("wa-input"));
});

test("anuncia con 'change-email-sent' la dirección a la que fue el enlace", async () => {
	const changeEmail = vi.fn().mockResolvedValue(undefined);
	const el = await mount({
		refreshEmailVerification: vi.fn().mockResolvedValue(USER),
		changeEmail,
	});
	const sent = vi.fn();
	el.addEventListener("change-email-sent", sent);
	const input = el.querySelector<HTMLInputElement>("wa-input");
	if (!input) throw new Error("No new-email field");
	input.value = "a@example.com";
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
	el.querySelector("form")?.requestSubmit();

	await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
	expect(changeEmail).toHaveBeenCalledWith("a@example.com");
	expect(sent).toHaveBeenCalledWith(
		expect.objectContaining({ detail: "a@example.com" }),
	);
});
