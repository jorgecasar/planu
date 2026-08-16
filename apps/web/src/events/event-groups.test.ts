import { expect, test } from "vitest";
import type { EventGroups } from "../domain/sort-events.js";
import type { StoredEvent } from "../lib/types.js";
import "./event-groups.js";
import type { PlanuEventGroups } from "./event-groups.js";

const event = (title: string): StoredEvent => ({
	id: title,
	title,
	description: "",
	location: "",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: "u1",
	memberIds: ["u1"],
	roles: {},
	tags: [],
	createdAt: null,
});

const groups = (
	overrides: Partial<EventGroups<StoredEvent>> = {},
): EventGroups<StoredEvent> => ({
	upcoming: [],
	undated: [],
	past: [],
	...overrides,
});

async function mount(
	setup: (el: PlanuEventGroups) => void,
): Promise<PlanuEventGroups> {
	const el = document.createElement("planu-event-groups") as PlanuEventGroups;
	setup(el);
	document.body.append(el);
	await el.updateComplete;
	return el;
}

const details = (el: PlanuEventGroups) =>
	el.shadowRoot?.querySelector("wa-details") as
		| (HTMLElement & { open: boolean })
		| null;

const cards = (el: PlanuEventGroups) =>
	el.shadowRoot?.querySelectorAll("planu-event-card") ?? [];

/**
 * Los encabezados que **de verdad** llegan al árbol de accesibilidad.
 *
 * `querySelectorAll("h2")` los encuentra aunque estén `aria-hidden`, y con eso
 * un mutante que los sacaba del árbol dejaba el test en verde. Es el mismo
 * pecado que `textContent`: encontrar un nodo no prueba que se anuncie.
 */
const headings = (el: PlanuEventGroups) =>
	[...(el.shadowRoot?.querySelectorAll('h2:not([aria-hidden="true"])') ?? [])]
		.filter((h) => (h as HTMLElement).checkVisibility())
		.map((h) => h.textContent?.trim());

test("cada grupo con contenido trae su encabezado", async () => {
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			upcoming: [event("Futuro")],
			undated: [event("Sin fecha")],
			past: [event("Pasado")],
		});
	});

	expect(headings(el)).toEqual(["Upcoming", "Without a date", "Past"]);
	el.remove();
});

test("un grupo vacío no deja un encabezado suelto", async () => {
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({ upcoming: [event("Futuro")] });
	});

	expect(headings(el)).toEqual(["Upcoming"]);
	expect(details(el)).toBeNull();
	el.remove();
});

test("el pasado sale plegado cuando hay algo más que mirar", async () => {
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			upcoming: [event("Futuro")],
			past: [event("Pasado")],
		});
	});

	expect(details(el)?.open).toBe(false);
	el.remove();
});

test("el pasado sale abierto si es lo único que hay", async () => {
	// Con el pliegue cerrado, esta pantalla no enseña ni una tarjeta ni el
	// mensaje de lista vacía: sólo una franja de acordeón.
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({ past: [event("Pasado")] });
	});

	expect(details(el)?.open).toBe(true);
	el.remove();
});

test("el pasado sale abierto cuando el usuario ha acotado el listado", async () => {
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			upcoming: [event("Futuro")],
			past: [event("Feria de abril")],
		});
		groupsEl.narrowed = true;
	});

	expect(details(el)?.open).toBe(true);
	el.remove();
});

test("todos los eventos se pintan, también los del pliegue", async () => {
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			upcoming: [event("A")],
			undated: [event("B")],
			past: [event("C"), event("D")],
		});
	});

	expect(cards(el)).toHaveLength(4);
	el.remove();
});

test("el encabezado del pasado no va dentro del summary del wa-details", async () => {
	// `wa-details` marca su `<summary>` con `role="button"`, y ARIA declara
	// presentacionales a los hijos de un botón: un encabezado ahí no existiría
	// para la navegación por encabezados. Axe no lo detecta.
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({ past: [event("Pasado")] });
	});

	const heading = el.shadowRoot?.querySelector("h2");
	expect(heading?.textContent?.trim()).toBe("Past");
	expect(heading?.closest("wa-details")).toBeNull();
	expect(details(el)?.querySelector("h2")).toBeNull();
	el.remove();
});

test("la tarjeta cuelga del grupo y no es su hermana", async () => {
	// h1 → h2 del grupo → h3 del evento. Con h2 en la tarjeta, el evento
	// quedaba al mismo nivel que el grupo y la navegación por encabezados no
	// daba ninguna estructura.
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({ upcoming: [event("Concierto")] });
	});

	const card = el.shadowRoot?.querySelector("planu-event-card");
	await (card as unknown as { updateComplete: Promise<unknown> })
		.updateComplete;

	expect(card?.shadowRoot?.querySelector("h2")).toBeNull();
	expect(card?.shadowRoot?.querySelector("h3")?.textContent?.trim()).toBe(
		"Concierto",
	);
	el.remove();
});

test("las tarjetas se pintan, no sólo existen en el DOM", async () => {
	// `querySelectorAll` las encuentra aunque la rejilla esté oculta: un mutante
	// que ponía `display: none` a `.grid` dejaba verde el test que dice que
	// «todos los eventos se pintan».
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			upcoming: [event("Futuro")],
			undated: [event("Sin fecha")],
		});
	});

	for (const card of cards(el)) {
		expect((card as HTMLElement).checkVisibility()).toBe(true);
	}

	el.remove();
});

test("el pliegue se abre por el atributo, que es como lo usa la vista", async () => {
	// La vista lo pasa con `?narrowed=${...}`, es decir por **atributo**, y el
	// atributo llega vacío. Sin `type: Boolean` la propiedad vale `""` —falsy—
	// y el pliegue no se abre nunca. Los demás tests asignan la propiedad, que
	// es el único camino que producción no usa.
	const el = await mount((groupsEl) => {
		groupsEl.groups = groups({
			past: [event("Pasado")],
			upcoming: [event("Futuro")],
		});
	});
	expect(details(el)?.open).toBe(false);

	el.setAttribute("narrowed", "");
	await el.updateComplete;

	expect(details(el)?.open).toBe(true);
	el.remove();
});

test("el rótulo del pliegue tiene singular de verdad", async () => {
	// «Show 1 past events» era el caso más común, y no es decoración: es el
	// nombre accesible del `<summary role="button">`.
	const uno = await mount((groupsEl) => {
		groupsEl.groups = groups({ past: [event("Pasado")] });
	});
	expect(details(uno)?.getAttribute("summary")).toBe("Show 1 past event");
	uno.remove();

	const dos = await mount((groupsEl) => {
		groupsEl.groups = groups({ past: [event("Uno"), event("Dos")] });
	});
	expect(
		dos.shadowRoot?.querySelector("wa-details")?.getAttribute("summary"),
	).toBe("Show 2 past events");
	dos.remove();
});
