import { expect, test } from "vitest";
import "./event-filters.js";
import type { FiltersChange, PlanuEventFilters } from "./event-filters.js";

async function mount(
	availableTags: readonly string[],
): Promise<PlanuEventFilters> {
	const el = document.createElement("planu-event-filters") as PlanuEventFilters;
	el.availableTags = availableTags;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

type CheckboxHost = HTMLElement & {
	value: string;
	updateComplete?: Promise<unknown>;
};

const box = (el: PlanuEventFilters, tag: string): CheckboxHost | null =>
	el.shadowRoot?.querySelector<CheckboxHost>(`wa-checkbox[value="${tag}"]`) ??
	null;

/**
 * Lets the interaction finish propagating.
 *
 * The native `change` on the `input` doesn't cross the shadow root —it isn't
 * `composed`—, so `wa-checkbox` fires its own after its update cycle.
 * Waiting only on the filter's `updateComplete` arrived before the event:
 * the test passed or not depending on the clock.
 */
const settle = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

/**
 * Clicks the checkbox the way a person would: on the native `input` that
 * `wa-checkbox` hides in its shadow root.
 *
 * Dispatching a synthetic `change` on the host doesn't work for what these
 * tests watch: what `live()` fixes is exactly the divergence between the
 * DOM the user leaves and the last thing Lit wrote, and only a real click
 * produces it.
 */
async function click(el: PlanuEventFilters, tag: string): Promise<void> {
	const host = box(el, tag);
	await host?.updateComplete;
	host?.shadowRoot?.querySelector("input")?.click();
	await settle();
	await el.updateComplete;
}

const isChecked = (el: PlanuEventFilters, tag: string): boolean | undefined =>
	box(el, tag)?.shadowRoot?.querySelector("input")?.checked;

const clearButton = (el: PlanuEventFilters): HTMLElement | null =>
	el.shadowRoot?.querySelector("wa-button") ?? null;

function listen(el: PlanuEventFilters): FiltersChange[] {
	const seen: FiltersChange[] = [];
	el.addEventListener("planu-filters-change", (event) => {
		seen.push((event as CustomEvent<FiltersChange>).detail);
	});
	return seen;
}

test("sin etiquetas conocidas no se ofrece el grupo", async () => {
	const el = await mount([]);
	expect(el.shadowRoot?.querySelector("wa-checkbox-group")).toBeNull();
	el.remove();
});

test("marcar una etiqueta la emite en el filtro", async () => {
	const el = await mount(["arte", "cine"]);
	const emitted = listen(el);

	await click(el, "cine");

	expect(emitted.at(-1)?.tags).toEqual(["cine"]);
	el.remove();
});

test("limpiar deja las casillas desmarcadas, no sólo el filtro", async () => {
	// This is exactly what `?checked` couldn't achieve: its attribute maps
	// to `defaultChecked`, so the component ignores it after the first
	// interaction and the checkbox stayed painted as checked while the
	// listing already came out unfiltered.
	const el = await mount(["arte", "cine"]);
	const emitted = listen(el);

	await click(el, "cine");
	expect(isChecked(el, "cine")).toBe(true);

	clearButton(el)?.click();
	await settle();
	await el.updateComplete;

	expect(emitted.at(-1)?.tags).toEqual([]);
	expect(isChecked(el, "cine")).toBe(false);
	el.remove();
});

test("una etiqueta seleccionada sigue visible aunque deje de existir", async () => {
	// Filter by "cine", I edit that event and remove the tag: `knownTags`
	// loses it. Painting only `availableTags`, the checkbox would
	// disappear from the DOM with the filter still on and the listing
	// would stay empty forever, with nothing checked to explain it.
	const el = await mount(["arte", "cine"]);
	await click(el, "cine");

	el.availableTags = ["arte"];
	await el.updateComplete;

	expect(box(el, "cine")).not.toBeNull();
	expect(isChecked(el, "cine")).toBe(true);
	el.remove();
});

test("la última etiqueta seleccionada mantiene el grupo en pie", async () => {
	// If it was the user's only one, `availableTags` ends up empty and the
	// whole group would disappear: there wasn't even one checkbox left to
	// uncheck.
	const el = await mount(["cine"]);
	await click(el, "cine");

	el.availableTags = [];
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("wa-checkbox-group")).not.toBeNull();
	expect(isChecked(el, "cine")).toBe(true);
	el.remove();
});

test("una etiqueta no se pinta dos veces por estar seleccionada", async () => {
	const el = await mount(["arte", "cine"]);
	await click(el, "cine");
	await el.updateComplete;

	expect(
		el.shadowRoot?.querySelectorAll('wa-checkbox[value="cine"]'),
	).toHaveLength(1);
	el.remove();
});

test("reordenar no le mueve el foco a quien navega con el teclado", async () => {
	// What `repeat()`'s key buys. Without it Lit reuses nodes by position:
	// the focus stays on the first checkbox's node, which just had its
	// value rewritten, and the user ends up on "arte" without having
	// clicked anything. The checked state and the label do get reapplied
	// by `live()` and the bindings, so they don't prove anything here.
	const el = await mount(["cine", "teatro"]);
	const host = box(el, "cine");
	await host?.updateComplete;
	host?.shadowRoot?.querySelector("input")?.focus();

	// When an event with "arte" is created, `knownTags` reorders and
	// "cine" is no longer first.
	el.availableTags = ["arte", "cine", "teatro"];
	await el.updateComplete;

	const focused = el.shadowRoot?.activeElement as CheckboxHost | null;
	expect(focused?.value).toBe("cine");
	el.remove();
});
