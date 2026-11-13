import { expect, test, vi } from "vitest";
import "./login-view.js";
import { loginNoticeState } from "./login-notice.js";
import type { PlanuLoginView } from "./login-view.js";

/** Mounted and past the notice's delay, whether one is coming or not. */
async function mount(): Promise<PlanuLoginView> {
	const el = document.createElement("planu-login-view");
	document.body.append(el);
	await el.updateComplete;
	await new Promise((resolve) => setTimeout(resolve, 300));
	await el.updateComplete;
	return el;
}

function status(el: PlanuLoginView): string {
	return (
		el.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim() ?? ""
	);
}

test("tras borrar la cuenta, la página de acceso lo dice en una región viva", async () => {
	window.history.replaceState(loginNoticeState("account-deleted"), "");

	const el = await mount();

	expect(status(el)).toContain("Your account has been deleted.");
	el.remove();
});

test("la región viva nace vacía y el aviso llega después, para que se anuncie", async () => {
	window.history.replaceState(loginNoticeState("account-deleted"), "");
	const el = document.createElement("planu-login-view");
	document.body.append(el);
	await el.updateComplete;
	// Well past a frame and a zero-delay task, still short of the delay.
	await new Promise((resolve) => setTimeout(resolve, 100));
	await el.updateComplete;

	expect(status(el)).toBe("");
	await vi.waitFor(() => expect(status(el)).toContain("has been deleted"));
	el.remove();
});

test("desmontar antes del retardo cancela el aviso pendiente", async () => {
	window.history.replaceState(loginNoticeState("account-deleted"), "");
	const el = document.createElement("planu-login-view");
	document.body.append(el);
	el.remove();

	await new Promise((resolve) => setTimeout(resolve, 300));

	expect((el as unknown as { notice?: string }).notice).toBeUndefined();
});

test("el aviso no vuelve a aparecer al recargar", async () => {
	window.history.replaceState(loginNoticeState("account-deleted"), "");
	(await mount()).remove();

	const again = await mount();

	expect(status(again)).toBe("");
	again.remove();
});

test("si la sesión se cortó a mitad del borrado, se le pide que vuelva a borrarla", async () => {
	window.history.replaceState(loginNoticeState("deletion-interrupted"), "");

	const el = await mount();

	expect(status(el)).toContain("delete it once more");
	el.remove();
});

test("sin aviso, la región viva está vacía", async () => {
	window.history.replaceState({}, "");

	const el = await mount();

	expect(el.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
	expect(status(el)).toBe("");
	el.remove();
});
