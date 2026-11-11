import { html, render } from "lit";
import { expect, test, vi } from "vitest";
import type { SessionPort, SessionUser } from "../application/ports/session.js";
import { ReauthStep } from "./reauth-step.js";

const PASSWORD = { uid: "u1", provider: "password" } as SessionUser;

function fakeSession(reauthenticate = vi.fn().mockResolvedValue(undefined)) {
	return { reauthenticate } as unknown as SessionPort;
}

test("reautentica con la contraseña y sigue ocupado mientras corre el reintento", async () => {
	const host = { requestUpdate: vi.fn() };
	const step = new ReauthStep(host);
	step.password = "secret123";
	const session = fakeSession();
	let busyDuringRetry = false;
	let updatesBeforeRetry = 0;

	const retry = async () => {
		busyDuringRetry = step.busy;
		updatesBeforeRetry = host.requestUpdate.mock.calls.length;
	};
	await step.confirm(session, PASSWORD, retry, vi.fn());

	expect(session.reauthenticate).toHaveBeenCalledWith("secret123");
	expect(busyDuringRetry).toBe(true);
	expect(updatesBeforeRetry).toBe(1);
	expect(step.busy).toBe(false);
	expect(host.requestUpdate).toHaveBeenCalledTimes(2);
	expect(step.password).toBe("");
});

test("sus botones van al slot footer del diálogo y el error es una alerta", () => {
	const host = { requestUpdate: vi.fn() };
	const step = new ReauthStep(host);
	const root = document.createElement("div");
	render(html`${step.render(PASSWORD, "Nope", vi.fn(), vi.fn())}`, root);
	const password = root.querySelector<HTMLInputElement>("wa-input");
	if (!password) throw new Error("No password field");
	password.value = "secret123";
	password.dispatchEvent(new Event("input"));
	expect(step.password).toBe("secret123");
	expect(host.requestUpdate).toHaveBeenCalledOnce();
	step.reset();
	expect(step.password).toBe("");
	expect(host.requestUpdate).toHaveBeenCalledTimes(2);

	const buttons = [...root.querySelectorAll("wa-button")];
	expect(buttons.map((b) => b.getAttribute("slot"))).toEqual([
		"footer",
		"footer",
	]);
	expect(buttons[1]?.hasAttribute("disabled")).toBe(true);
	expect(root.querySelector('[role="alert"]')?.textContent).toContain("Nope");
	expect(root.querySelector('wa-input[type="password"]')).not.toBeNull();
});
