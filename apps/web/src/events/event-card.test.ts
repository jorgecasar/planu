import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import "./event-card.js";
import type { PlanuEventCard } from "./event-card.js";

const event = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
	id: "e1",
	title: "Concierto de verano",
	description: "",
	location: "",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: "u1",
	memberIds: ["u1"],
	roles: {},
	allDay: true,
	tags: [],
	createdAt: null,
	...overrides,
});

/**
 * The card reads the session from a context; with no provider in the test,
 * the field is set by hand, the same trick `event-editor.test.ts` uses for
 * its repository.
 */
async function mount(
	stored: StoredEvent,
	uid: string | null = "u1",
): Promise<PlanuEventCard> {
	const el = document.createElement("planu-event-card") as PlanuEventCard;
	el.event = stored;
	(el as unknown as { user: unknown }).user = uid ? { uid } : null;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

const dateBlock = (el: PlanuEventCard): string =>
	el.shadowRoot
		?.querySelector(".date-block")
		?.textContent?.replace(/\s+/g, " ")
		.trim() ?? "";

// ── Date block (GH-188) ──────────────────────────────────────────────────────

test("la tarjeta empieza por el día y el mes", async () => {
	const el = await mount(event({ startDate: new Date(2026, 5, 12) }));

	expect(dateBlock(el)).toBe("12 Jun");
	// Before the title in the DOM, not just painted on its left.
	const block = el.shadowRoot?.querySelector(".date-block");
	expect(block?.nextElementSibling?.querySelector("h3")).toBeTruthy();
	el.remove();
});

test("sin fecha, el bloque lo dice en vez de quedarse vacío", async () => {
	const el = await mount(event());
	expect(dateBlock(el)).toBe("No date");
	el.remove();
});

test("la descripción se corta a dos líneas", async () => {
	// Measured against a one-line description in the same card, not against
	// `line-height`: the test page loads no theme, so the token behind it
	// resolves to `normal`, which has no number to compare with.
	const height = async (description: string) => {
		const el = await mount(event({ description }));
		el.style.inlineSize = "20rem";
		await el.updateComplete;
		const box = el.shadowRoot
			?.querySelector(".description")
			?.getBoundingClientRect();
		el.remove();
		return box?.height ?? 0;
	};

	const line = await height("Corta.");
	const long = await height("Una descripción larga. ".repeat(40));
	expect(line).toBeGreaterThan(0);
	expect(long).toBeGreaterThan(line);
	expect(long).toBeLessThanOrEqual(2 * line + 1);
});

// ── Clickable card (GH-188) ──────────────────────────────────────────────────

/** What a pointer at the centre of `target` would hit inside the card. */
function hitAt(el: PlanuEventCard, target: Element | null | undefined) {
	const box = target?.getBoundingClientRect();
	if (!box) return null;
	return (
		el.shadowRoot?.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		) ?? null
	);
}

test("pulsar en cualquier parte de la tarjeta abre el editor", async () => {
	const el = await mount(event({ description: "Al aire libre." }));
	const opened: unknown[] = [];
	el.addEventListener("planu-edit-event", (e) =>
		opened.push((e as CustomEvent).detail),
	);

	// The description is not a control: what lies under it is the title's
	// stretched layer, so the click lands on the one button.
	const hit = hitAt(el, el.shadowRoot?.querySelector(".description"));
	expect(hit?.matches("button.open")).toBe(true);
	(hit as HTMLElement).click();

	expect(opened).toHaveLength(1);
	el.remove();
});

test("los controles del pie siguen recibiendo su clic", async () => {
	const el = await mount(event());
	const edit = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(button) => button.textContent?.includes("Edit"),
	);
	expect(hitAt(el, edit)?.closest("wa-button")).toBe(edit);
	el.remove();
});

test("«Editar» dice qué evento edita", async () => {
	const el = await mount(event());
	const edit = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(button) => button.textContent?.includes("Edit"),
	);
	expect(edit?.textContent?.replace(/\s+/g, " ").trim()).toBe(
		"Edit Concierto de verano",
	);
	el.remove();
});

test("la tarjeta no añade una parada de tabulador a «Editar»", async () => {
	// Title and «Edit» do the same thing: both in the tab order made seven
	// cards cost 21 stops instead of 14. The title stays a pointer target.
	const el = await mount(event());
	expect(
		el.shadowRoot?.querySelector<HTMLElement>("button.open")?.tabIndex,
	).toBe(-1);
	el.remove();
});

test("quien sólo puede leer no tiene tarjeta que pulsar", async () => {
	// The editor has no read-only mode: opening it for a viewer would offer
	// a save the rules then reject.
	const el = await mount(
		event({ memberIds: ["u1", "u2"], roles: { u2: "viewer" } }),
		"u2",
	);
	expect(el.shadowRoot?.querySelector("button.open")).toBeNull();
	expect(el.shadowRoot?.querySelector("h3")?.textContent?.trim()).toBe(
		"Concierto de verano",
	);
	el.remove();
});
