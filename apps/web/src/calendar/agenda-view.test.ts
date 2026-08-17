// El tema de Web Awesome, igual que lo carga `main.ts`. Sin él ningún token
// `--wa-*` resuelve, los fondos quedan transparentes y axe no puede calcular el
// contraste: devuelve nodos en `incomplete` y «cero violaciones» significa en
// realidad «no he podido mirar».
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import axe from "axe-core";
import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import type { Agenda } from "./agenda-days.js";
import { buildAgenda } from "./agenda-days.js";
import "./agenda-view.js";
import type { PlanuAgendaView } from "./agenda-view.js";

function local(text: string): Date {
	return new Date(text.includes("T") ? text : `${text}T12:00`);
}

function event(
	id: string,
	title: string,
	start: string | null,
	end?: string | null,
): StoredEvent {
	return {
		id,
		title,
		description: "",
		location: "",
		startDate: start ? local(start) : null,
		endDate: end ? local(end) : null,
		imageUrl: "",
		userId: "u1",
		memberIds: ["u1"],
		roles: {},
		tags: [],
		createdAt: null,
	};
}

const NOW = local("2026-06-15T10:00");

/**
 * Un evento **terminado**, con su fin declarado.
 *
 * No basta con ponerle un inicio en el pasado: desde que `groupOf` respeta la
 * semántica del calendario, un evento sin fin declarado sigue en curso para
 * siempre. Decir «pasado» exige decir cuándo acabó.
 */
function past(id: string, title: string, day: string): StoredEvent {
	return event(id, title, day, day);
}

const EMPTY: Agenda<StoredEvent> = { upcoming: [], undated: [], past: [] };

/** La agenda tal y como la construye la vista de eventos, sin atajos. */
function agenda(events: StoredEvent[]): Agenda<StoredEvent> {
	return buildAgenda(events, { now: NOW, locale: "es" });
}

async function mount(
	setup: (el: PlanuAgendaView) => void = () => {},
): Promise<PlanuAgendaView> {
	const el = document.createElement("planu-agenda-view") as PlanuAgendaView;
	el.agenda = EMPTY;
	setup(el);
	document.body.append(el);
	await el.updateComplete;
	return el;
}

/**
 * Los encabezados que **de verdad** llegan al árbol de accesibilidad.
 *
 * `querySelectorAll("h2")` los encuentra aunque estén `aria-hidden` o sin caja,
 * y con eso un mutante que los saca del árbol deja el test en verde. Encontrar
 * un nodo no prueba que se anuncie.
 */
const headings = (el: PlanuAgendaView) =>
	[...(el.shadowRoot?.querySelectorAll('h2:not([aria-hidden="true"])') ?? [])]
		.filter((heading) => (heading as HTMLElement).checkVisibility())
		.map((heading) => heading.textContent?.trim());

const cards = (el: PlanuAgendaView) => [
	...(el.shadowRoot?.querySelectorAll("planu-event-card") ?? []),
];

const details = (el: PlanuAgendaView) =>
	el.shadowRoot?.querySelector("wa-details") as
		| (HTMLElement & { open: boolean })
		| null;

test("cada día con contenido trae su encabezado, y en orden", async () => {
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			event("2", "Cena", "2026-06-20"),
			event("3", "Concierto", "2026-06-21"),
		]);
	});

	expect(headings(el)).toEqual([
		"sábado, 20 de junio de 2026",
		"domingo, 21 de junio de 2026",
	]);
	el.remove();
});

test("los eventos de un día cuelgan de su encabezado, no son sus hermanos", async () => {
	// h1 planu → h2 día → h3 tarjeta. Con h2 en la tarjeta el evento quedaría al
	// mismo nivel que su día y navegar por encabezados no daría estructura.
	const el = await mount((view) => {
		view.agenda = agenda([event("1", "Concierto", "2026-06-20")]);
	});

	const card = cards(el)[0];
	await (card as unknown as { updateComplete: Promise<unknown> })
		.updateComplete;

	expect(card?.shadowRoot?.querySelector("h2")).toBeNull();
	expect(card?.shadowRoot?.querySelector("h3")?.textContent?.trim()).toBe(
		"Concierto",
	);
	el.remove();
});

test("las tarjetas se pintan, no sólo existen en el DOM", async () => {
	// `querySelectorAll` las encuentra aunque la lista esté oculta: un mutante
	// que pone `display: none` a `.day-events` dejaría verde un test que sólo
	// las contara.
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			event("2", "Algún día", null),
		]);
	});

	expect(cards(el)).toHaveLength(2);
	for (const card of cards(el)) {
		expect((card as HTMLElement).checkVisibility()).toBe(true);
	}
	el.remove();
});

test("los que no tienen fecha van a su propio grupo", async () => {
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			event("2", "Algún día", null),
		]);
	});

	expect(headings(el)).toEqual([
		"sábado, 20 de junio de 2026",
		"Without a date",
	]);
	el.remove();
});

test("sin eventos sin fecha no queda un encabezado suelto", async () => {
	const el = await mount((view) => {
		view.agenda = agenda([event("1", "Taller", "2026-06-20")]);
	});

	expect(headings(el)).toEqual(["sábado, 20 de junio de 2026"]);
	expect(details(el)).toBeNull();
	el.remove();
});

test("los días pasados salen plegados cuando hay algo más que mirar", async () => {
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			past("2", "Feria", "2026-06-01"),
		]);
	});

	expect(details(el)?.open).toBe(false);
	// Plegado, sus encabezados no están en el árbol: es lo que se espera de un
	// pliegue cerrado, y la razón de mirar `checkVisibility` y no el DOM.
	expect(headings(el)).toEqual(["sábado, 20 de junio de 2026"]);
	el.remove();
});

test("los días pasados salen abiertos si son lo único que hay", async () => {
	// Con el pliegue cerrado esta pantalla no enseña ni una tarjeta ni un
	// mensaje: sólo una franja de acordeón.
	const el = await mount((view) => {
		view.agenda = agenda([past("1", "Feria", "2026-06-01")]);
	});

	expect(details(el)?.open).toBe(true);
	expect(headings(el)).toEqual(["lunes, 1 de junio de 2026"]);
	el.remove();
});

test("el pliegue se abre por el atributo, que es como lo usa la vista", async () => {
	// La vista de eventos lo pasa con `?narrowed=${...}`, es decir por
	// **atributo**, y el atributo llega vacío. Sin `type: Boolean` la propiedad
	// vale `""` —falsy— y el pliegue no se abre nunca. Asignar la propiedad, que
	// es lo cómodo en un test, recorre el único camino que producción no usa.
	//
	// Y el escenario está construido para que **sólo** esta regla explique el
	// resultado: hay un día próximo, así que la otra apertura —«es lo único que
	// hay»— no puede abrirlo.
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			past("2", "Feria", "2026-06-01"),
		]);
	});
	expect(details(el)?.open).toBe(false);

	el.setAttribute("narrowed", "");
	await el.updateComplete;

	expect(details(el)?.open).toBe(true);
	expect(headings(el)).toEqual([
		"sábado, 20 de junio de 2026",
		"lunes, 1 de junio de 2026",
	]);
	el.remove();
});

test("acotar el listado no abre el pliegue si no hay nada pasado", async () => {
	// El caso contrario del anterior: `narrowed` no puede inventar un pliegue.
	const el = await mount((view) => {
		view.agenda = agenda([event("1", "Taller", "2026-06-20")]);
		view.narrowed = true;
	});

	expect(details(el)).toBeNull();
	el.remove();
});

/**
 * Lo que se ve de arriba abajo: encabezados y el pliegue, en orden de
 * documento. El pliegue se nombra aparte para que la aserción se lea.
 */
const outline = (el: PlanuAgendaView) =>
	[...(el.shadowRoot?.querySelectorAll("h2, wa-details") ?? [])].map((node) =>
		node.localName === "wa-details" ? "pliegue" : node.textContent?.trim(),
	);

test("lo plegado va al final y los sin fecha en medio", async () => {
	// El invariante está escrito en `event-groups.ts`: los que no tienen fecha
	// quedan en medio **para que lo plegado siga siendo lo último de la
	// página**. Intercambiar los dos bloques dejaba la suite verde.
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			event("2", "Algún día", null),
			past("3", "Feria", "2026-06-01"),
		]);
	});

	expect(outline(el)).toEqual([
		"sábado, 20 de junio de 2026",
		"Without a date",
		"pliegue",
		"lunes, 1 de junio de 2026",
	]);
	el.remove();
});

test("con eventos sin fecha, el pasado no es «lo único que hay»", async () => {
	// Sin ningún próximo pero con eventos sin fecha, la pantalla ya enseña algo,
	// así que el pliegue se queda cerrado — es lo que hace `event-groups` y lo
	// que dice `shouldRevealPast`. Pasarle `undated: 0` lo abría, y ningún test
	// construía esta forma: hace falta que `upcoming` esté vacío y `undated` no.
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Algún día", null),
			past("2", "Feria", "2026-06-01"),
		]);
	});

	expect(details(el)?.open).toBe(false);
	expect(headings(el)).toEqual(["Without a date"]);
	el.remove();
});

test("el rótulo del pliegue cuenta eventos, no días, y tiene singular", async () => {
	// Es el nombre accesible del `<summary role="button">`, no decoración. Y
	// contar días diría «Show 1 past events» con dos ferias del mismo día.
	const uno = await mount((view) => {
		view.agenda = agenda([past("1", "Feria", "2026-06-01")]);
	});
	expect(details(uno)?.getAttribute("summary")).toBe("Show 1 past event");
	uno.remove();

	const dos = await mount((view) => {
		view.agenda = agenda([
			past("1", "Feria", "2026-06-01"),
			past("2", "Mercadillo", "2026-06-01"),
		]);
	});
	expect(details(dos)?.getAttribute("summary")).toBe("Show 2 past events");
	dos.remove();
});

test("los días pasados siguen teniendo encabezado dentro del pliegue", async () => {
	// El pliegue nombra al control, no al día. Sin encabezados dentro, abrirlo
	// dejaría una tira de tarjetas sin ninguna estructura por la que navegar.
	const el = await mount((view) => {
		view.agenda = agenda([
			past("1", "Feria", "2026-06-01"),
			past("2", "Mercadillo", "2026-06-03"),
		]);
	});

	expect(details(el)?.open).toBe(true);
	expect(headings(el)).toEqual([
		"lunes, 1 de junio de 2026",
		"miércoles, 3 de junio de 2026",
	]);
	el.remove();
});

test("axe no encuentra ninguna violación en la agenda", async () => {
	// La aceptación de F5 pide axe en cada una de las tres vistas. Aquí y no
	// sólo en el e2e: así el oráculo corre en cada `npm test`.
	const el = await mount((view) => {
		view.agenda = agenda([
			event("1", "Taller", "2026-06-20"),
			event("2", "Algún día", null),
			past("3", "Feria", "2026-06-01"),
		]);
	});

	const results = await axe.run(el, {
		runOnly: {
			type: "tag",
			values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
		},
	});

	expect(results.violations.map((violation) => violation.id)).toEqual([]);
	expect(results.passes.length).toBeGreaterThan(0);
	el.remove();
});

test("el contraste de la agenda se mide, no se da por bueno", async () => {
	// `incomplete` es «no he podido mirar». Sin el tema cargado los fondos son
	// `rgba(0,0,0,0)` y axe devuelve «background color could not be determined»:
	// justo la regla que más papeletas tiene de romperse aquí quedaría sin
	// comprobar. Se acota a los encabezados de día, que es lo que esta vista
	// añade: las tarjetas ya las mide `events.spec.ts`.
	const el = await mount((view) => {
		view.agenda = agenda([event("1", "Taller", "2026-06-20")]);
	});
	const heading = el.shadowRoot?.querySelector(".day-title");

	const results = await axe.run(heading as HTMLElement, {
		runOnly: { type: "rule", values: ["color-contrast"] },
	});

	expect(results.violations.map((issue) => issue.id)).toEqual([]);
	expect(
		results.incomplete.flatMap((issue) =>
			issue.nodes.map((node) => node.target.join(" ")),
		),
	).toEqual([]);
	// Sin esto, acotar a un selector que no encuentra nada daría las dos listas
	// vacías: «no hay violaciones» y «no se ha mirado» se escriben igual.
	expect(results.passes.length).toBeGreaterThan(0);

	el.remove();
});
