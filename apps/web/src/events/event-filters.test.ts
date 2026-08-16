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
 * Deja que la interacción termine de propagarse.
 *
 * El `change` nativo del `input` no cruza el shadow root —no es `composed`—, así
 * que `wa-checkbox` emite el suyo propio después de su ciclo de actualización.
 * Esperar sólo a `updateComplete` del filtro llegaba antes que el evento: el
 * test pasaba o no según el reloj.
 */
const settle = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

/**
 * Pulsa la casilla como lo haría una persona: sobre el `input` nativo que
 * `wa-checkbox` esconde en su shadow root.
 *
 * Despachar un `change` sintético sobre el host no vale para lo que estos tests
 * vigilan: lo que `live()` arregla es justo la divergencia entre el DOM que deja
 * el usuario y lo último que Lit escribió, y sólo un clic de verdad la produce.
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
	// Es exactamente lo que `?checked` no conseguía: su atributo mapea a
	// `defaultChecked`, así que el componente lo ignora tras la primera
	// interacción y la casilla se quedaba pintada como marcada mientras el
	// listado ya salía sin filtrar.
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
	// Filtro por «cine», edito ese evento y le quito la etiqueta: `knownTags`
	// la pierde. Pintando sólo `availableTags`, la casilla desaparecía del DOM
	// con el filtro todavía puesto y el listado se quedaba vacío para siempre,
	// sin nada marcado que lo explicase.
	const el = await mount(["arte", "cine"]);
	await click(el, "cine");

	el.availableTags = ["arte"];
	await el.updateComplete;

	expect(box(el, "cine")).not.toBeNull();
	expect(isChecked(el, "cine")).toBe(true);
	el.remove();
});

test("la última etiqueta seleccionada mantiene el grupo en pie", async () => {
	// Si era la única del usuario, `availableTags` se queda vacío y el grupo
	// entero desaparecía: no quedaba ni una casilla que desmarcar.
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
	// Lo que compra la clave de `repeat()`. Sin ella Lit reutiliza los nodos por
	// posición: el foco se queda en el nodo de la primera casilla, al que le
	// acaban de reescribir el valor, y el usuario se encuentra sobre «arte» sin
	// haber pulsado nada. El marcado y el rótulo sí los reaplican `live()` y los
	// bindings, así que no son prueba de nada aquí.
	const el = await mount(["cine", "teatro"]);
	const host = box(el, "cine");
	await host?.updateComplete;
	host?.shadowRoot?.querySelector("input")?.focus();

	// Al crear un evento con «arte», `knownTags` se reordena y «cine» deja de
	// ser la primera.
	el.availableTags = ["arte", "cine", "teatro"];
	await el.updateComplete;

	const focused = el.shadowRoot?.activeElement as CheckboxHost | null;
	expect(focused?.value).toBe("cine");
	el.remove();
});
