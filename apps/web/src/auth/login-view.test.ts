import { afterEach, expect, test, vi } from "vitest";
import type { SessionPort } from "../application/ports/session.js";
import { SessionError } from "../domain/session-error.js";
import "./login-view.js";
import { loginNoticeState } from "./login-notice.js";
import type { PlanuLoginView } from "./login-view.js";

afterEach(() => {
	document.body.replaceChildren();
});

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

// --- Errors next to the field that caused them (GH-190) ----------------------

type Field = HTMLElement & { hint: string; updateComplete: Promise<unknown> };

async function mountWith(session: Partial<SessionPort>) {
	const el = document.createElement("planu-login-view");
	Object.assign(el, { session });
	document.body.append(el);
	await el.updateComplete;
	const root = el.shadowRoot as ShadowRoot;
	const form = (name: string) =>
		root.querySelector(`wa-tab-panel[name=${name}] form`) as HTMLFormElement;
	const field = (panel: string, name: string) =>
		form(panel).querySelector(`[name=${name}]`) as Field;
	const fill = async (panel: string, values: Record<string, string>) => {
		for (const [name, value] of Object.entries(values)) {
			Object.assign(field(panel, name), { value });
			await field(panel, name).updateComplete;
		}
	};
	const callout = () => root.querySelector("wa-callout");
	/** The message in the field's hint slot, announced as an alert. */
	const error = (panel: string, name: string) =>
		field(panel, name)
			.querySelector('[slot="hint"][role="alert"]')
			?.textContent?.trim() ?? "";
	return { el, form, field, fill, callout, error };
}

test("wrong credentials show under the password, which takes the focus", async () => {
	const signIn = vi
		.fn()
		.mockRejectedValue(new SessionError("invalid-credential"));
	const view = await mountWith({ signIn });
	await view.fill("signin", { email: "a@example.com", password: "secret123" });

	view.form("signin").requestSubmit();
	await vi.waitFor(() =>
		expect(view.error("signin", "password")).toBe("Wrong email or password."),
	);
	const password = view.field("signin", "password");
	expect(password.classList.contains("invalid")).toBe(true);
	// The theme is not loaded here: define the token the ::part rule must paint.
	const red = "rgb(255, 0, 0)";
	view.el.style.setProperty("--wa-color-danger-border-loud", red);
	const border = (f: Field) =>
		getComputedStyle(
			f.shadowRoot?.querySelector('[part~="input-wrapper"]') as Element,
		).borderTopColor;
	expect(border(password)).toBe(red);
	expect(border(view.field("signin", "email"))).not.toBe(red);
	const inner = password.shadowRoot?.querySelector("input");
	expect(inner?.getAttribute("aria-describedby")).toBe("hint");
	const slot = password.shadowRoot?.querySelector("slot#hint");
	expect((slot as HTMLSlotElement).assignedElements()[0]).toBe(
		password.querySelector('[slot="hint"]'),
	);
	// wa-input 3.x never renders `aria-invalid` on its inner input and has no
	// API for it (`setCustomValidity` only reaches ElementInternals). Pinned
	// so a Web Awesome release that adds it shows up here.
	expect(inner?.hasAttribute("aria-invalid")).toBe(false);
	expect(view.callout()).toBeNull();
	await vi.waitFor(() =>
		expect(view.el.shadowRoot?.activeElement).toBe(password),
	);
	view.form("signin").dispatchEvent(new Event("input", { bubbles: true }));
	await view.el.updateComplete;
	expect(view.error("signin", "password")).toBe("");
	expect(password.classList.contains("invalid")).toBe(false);
});

test("a mismatch on sign-up lands on the confirmation field", async () => {
	const view = await mountWith({ signUp: vi.fn() });
	await view.fill("signup", {
		email: "a@example.com",
		password: "secret123",
		confirmPassword: "secret124",
	});

	view.form("signup").requestSubmit();
	await vi.waitFor(() =>
		expect(view.error("signup", "confirmPassword")).toBe(
			"Passwords don't match.",
		),
	);
	expect(view.error("signup", "password")).toBe("");
	expect(view.field("signup", "password").hint).toBe("At least 6 characters.");
});

test("the message goes to the form that was sent, not its twin", async () => {
	const signUp = vi
		.fn()
		.mockRejectedValue(new SessionError("email-already-in-use"));
	const view = await mountWith({ signUp });
	await view.fill("signup", {
		email: "a@example.com",
		password: "secret123",
		confirmPassword: "secret123",
	});

	view.form("signup").requestSubmit();
	await vi.waitFor(() =>
		expect(view.error("signup", "email")).toBe(
			"That email is already registered.",
		),
	);
	expect(view.error("signin", "email")).toBe("");
});

test("an error no field caused stays a notice above the form", async () => {
	const signIn = vi.fn().mockRejectedValue(new SessionError("network-error"));
	const view = await mountWith({ signIn });
	await view.fill("signin", { email: "a@example.com", password: "secret123" });

	view.form("signin").requestSubmit();
	await vi.waitFor(() =>
		expect(view.callout()?.textContent?.trim()).toBe(
			"Network error. Check your connection.",
		),
	);
	expect(view.error("signin", "password")).toBe("");
});
