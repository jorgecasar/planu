import { expect, test } from "vitest";
import "./empty-state.js";
import type { PlanuEmptyState } from "./empty-state.js";

async function mount(aiAvailable = false): Promise<PlanuEmptyState> {
	const el = document.createElement("planu-empty-state") as PlanuEmptyState;
	el.aiAvailable = aiAvailable;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

const buttonLabels = (el: PlanuEmptyState): string[] =>
	[...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].map(
		(button) => button.textContent?.trim() ?? "",
	);

const button = (el: PlanuEmptyState, label: string): HTMLElement =>
	[...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(candidate) => candidate.textContent?.trim() === label,
	) as HTMLElement;

test("explica que no hay eventos y ofrece crear a mano y un ejemplo", async () => {
	const el = await mount(false);

	expect(el.shadowRoot?.textContent).toContain("You have no events yet.");
	expect(buttonLabels(el)).toEqual([
		"Create your first event",
		"Try a sample event instead",
	]);

	el.remove();
});

test("con IA disponible también se ofrece generar con IA", async () => {
	const el = await mount(true);

	expect(buttonLabels(el)).toEqual([
		"Create your first event",
		"Generate with AI",
		"Try a sample event instead",
	]);

	el.remove();
});

test("sin IA disponible no se ofrece un botón que fallaría siempre", async () => {
	const el = await mount(false);

	expect(buttonLabels(el)).not.toContain("Generate with AI");

	el.remove();
});

test("crear a mano emite planu-create-event y no decide nada más", async () => {
	const el = await mount(false);
	const seen: string[] = [];
	el.addEventListener("planu-create-event", () => seen.push("create"));

	button(el, "Create your first event").click();

	expect(seen).toEqual(["create"]);
	el.remove();
});

test("generar con IA emite planu-open-generator", async () => {
	const el = await mount(true);
	const seen: string[] = [];
	el.addEventListener("planu-open-generator", () => seen.push("generator"));

	button(el, "Generate with AI").click();

	expect(seen).toEqual(["generator"]);
	el.remove();
});

test("probar un ejemplo emite planu-try-sample, y no lo hace por su cuenta", async () => {
	const el = await mount(false);
	const seen: string[] = [];
	el.addEventListener("planu-try-sample", () => seen.push("sample"));

	// Nadie ha pulsado nada todavía: la invitación no actúa por su cuenta.
	expect(seen).toEqual([]);

	button(el, "Try a sample event instead").click();

	expect(seen).toEqual(["sample"]);
	el.remove();
});
