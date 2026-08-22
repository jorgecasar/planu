// El tema de Web Awesome, igual que lo carga `main.ts`. Sin él ningún token
// `--wa-*` resuelve, los fondos quedan transparentes y axe no puede calcular el
// contraste: devolvía dos nodos en `incomplete` —«background color could not be
// determined»— y la regla que más papeletas tiene de romperse aquí se estaba
// probando sobre un color que nadie verá nunca.
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import axe from "axe-core";
import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import "./calendar-view.js";
import type { PlanuCalendarView } from "./calendar-view.js";

function local(text: string): Date {
	return new Date(text.includes("T") ? text : `${text}T12:00`);
}

function event(
	id: string,
	title: string,
	start: string,
	end?: string,
	allDay = true,
) {
	return {
		id,
		title,
		startDate: local(start),
		endDate: end ? local(end) : null,
		memberIds: [],
		roles: {},
		allDay,
		tags: [],
	} satisfies StoredEvent;
}

const EVENTS: StoredEvent[] = [
	event("1", "Feria del libro", "2026-06-10"),
	event("2", "Congreso", "2026-06-29", "2026-07-02"),
	event("3", "Sin fecha", "2026-06-10"),
];

async function mount(
	setup: (view: PlanuCalendarView) => void = () => {},
): Promise<PlanuCalendarView> {
	const el = document.createElement("planu-calendar-view") as PlanuCalendarView;
	el.locale = "es";
	el.month = local("2026-06-15");
	el.today = local("2026-06-17");
	el.events = EVENTS;
	setup(el);
	document.body.append(el);
	await el.updateComplete;
	return el;
}

function cells(el: PlanuCalendarView): HTMLElement[] {
	return [
		...(el.shadowRoot?.querySelectorAll<HTMLElement>('[role="gridcell"]') ??
			[]),
	];
}

/** La celda que tiene el foco itinerante. */
function tabbable(el: PlanuCalendarView): HTMLElement | null {
	return (
		el.shadowRoot?.querySelector<HTMLElement>(
			'[role="gridcell"][tabindex="0"]',
		) ?? null
	);
}

/**
 * Pulsa una tecla sobre la celda que ahora mismo tiene el foco y devuelve el
 * evento, para poder mirar si se consumió.
 */
async function press(
	el: PlanuCalendarView,
	key: string,
	modifiers: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
	tabbable(el)?.focus();
	const domEvent = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		composed: true,
		cancelable: true,
		...modifiers,
	});
	tabbable(el)?.dispatchEvent(domEvent);
	await el.updateComplete;
	return domEvent;
}

function status(el: PlanuCalendarView): string {
	return el.shadowRoot?.querySelector('[role="status"]')?.textContent ?? "";
}

/**
 * El nombre accesible de un elemento, calculado por axe.
 *
 * `textContent` no sirve para esto: es ciego a `aria-hidden` y a si el texto
 * tiene caja. Un `display: none` en el texto oculto deja la celda sin nombre y
 * `textContent` no se entera.
 */
function accessibleName(node: Element): string {
	axe.setup(document.body);
	try {
		return axe.commons.text.accessibleText(node).replace(/\s+/g, " ").trim();
	} finally {
		axe.teardown();
	}
}

test("axe no encuentra ninguna violación en la rejilla", async () => {
	// La aceptación de F5 pide axe sobre la vista, y una rejilla de fechas es
	// donde axe encuentra problemas. Aquí y no sólo en el e2e: así el oráculo
	// corre en cada `npm test` en vez de esperar a una pasada que llega tarde.
	const el = await mount();

	const results = await axe.run(el, {
		runOnly: {
			type: "tag",
			values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
		},
	});

	expect(results.violations.map((violation) => violation.id)).toEqual([]);

	el.remove();
});

test("el contraste de la rejilla se mide, no se da por bueno", async () => {
	// `incomplete` es «no he podido mirar», y se descartaba en silencio: sin el
	// tema cargado, el fondo de las celdas era `rgba(0,0,0,0)` y axe devolvía
	// «background color could not be determined». El contraste es justo lo que
	// aquí depende de tokens —el día de relleno y el chip del evento—, así que
	// se comprueban las dos listas.
	//
	// La pasada va sobre la rejilla y no sobre el componente entero porque los
	// dos `wa-button` de la barra devuelven «overlapped by another element» por
	// su propia estructura interna: eso es de Web Awesome, no de T20.
	const el = await mount();
	const grid = el.shadowRoot?.querySelector(".grid");

	const results = await axe.run(grid as HTMLElement, {
		runOnly: { type: "rule", values: ["color-contrast"] },
	});

	expect(results.violations.map((issue) => issue.id)).toEqual([]);
	expect(
		results.incomplete.flatMap((issue) =>
			issue.nodes.map((node) => node.target.join(" ")),
		),
	).toEqual([]);

	el.remove();
});

test("la fecha completa llega al árbol de accesibilidad, no sólo al textContent", async () => {
	// El criterio de aceptación es «celdas etiquetadas con la fecha completa», y
	// `textContent` no lo mide: con la fecha oculta a `display: none` el nodo
	// sigue teniendo texto pero la celda se queda sin nombre accesible. Este
	// test compara el nombre calculado, que es lo que oye el usuario.
	const el = await mount();
	const empty = cells(el).find((cell) => cell.dataset["key"] === "20260602");
	const busy = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	// Sin eventos, el nombre es la fecha y nada más: el número del día va con
	// `aria-hidden` para no repetirlo detrás.
	expect(accessibleName(empty as Element)).toBe("martes, 2 de junio de 2026");

	// Con eventos, la fecha primero y los títulos después.
	expect(accessibleName(busy as Element)).toBe(
		"miércoles, 10 de junio de 2026 Feria del libro Sin fecha",
	);

	el.remove();
});

test("por defecto el título del mes no es un encabezado", async () => {
	// El nivel depende de dónde se monte la rejilla, así que fijarlo aquí
	// rompería el orden de encabezados de cualquier página que no sea la que se
	// tuvo en mente. Sin nivel, es un párrafo y nombra la rejilla por
	// `aria-labelledby`.
	const el = await mount();

	expect(el.shadowRoot?.querySelector("#month-title")?.localName).toBe("p");
	el.remove();
});

test("el nivel del encabezado llega por atributo, que es como lo monta la vista", async () => {
	// La vista de eventos lo pasa como `heading-level="2"`, es decir por
	// **atributo**: sin `type: Number` la propiedad valdría la cadena `"2"`, el
	// `switch` caería al caso por defecto y el mes se quedaría en párrafo, fuera
	// de la navegación por encabezados. Asignar la propiedad no probaría eso.
	const el = await mount();
	el.setAttribute("heading-level", "2");
	await el.updateComplete;

	const title = el.shadowRoot?.querySelector("#month-title");
	expect(title?.localName).toBe("h2");
	expect(accessibleName(title as Element)).toBe("junio de 2026");

	// Y sigue nombrando la rejilla: el `id` es lo que la etiqueta.
	expect(
		el.shadowRoot
			?.querySelector('[role="grid"]')
			?.getAttribute("aria-labelledby"),
	).toBe("month-title");

	el.remove();
});

test("las siete columnas se alinean de verdad", async () => {
	// Las filas llevan `display: contents` para que las celdas sean hijas de la
	// rejilla CSS. Sin eso —con `display: block`, por ejemplo— los roles siguen
	// ahí y todos los tests de ARIA pasan, pero el calendario se pinta como una
	// columna. Se comprueba la geometría, que es lo que se rompe.
	const el = await mount();
	const week = cells(el)
		.slice(0, 7)
		.map((cell) => cell.getBoundingClientRect());

	expect(new Set(week.map((box) => Math.round(box.top))).size).toBe(1);
	expect(new Set(week.map((box) => Math.round(box.left))).size).toBe(7);

	el.remove();
});

test("la rejilla tiene los roles que espera un lector de pantalla", async () => {
	const el = await mount();
	const grid = el.shadowRoot?.querySelector('[role="grid"]');

	expect(grid?.getAttribute("aria-labelledby")).toBe("month-title");
	// Las celdas no se editan desde aquí, y decirlo evita que un lector ofrezca
	// un modo de edición que no existe.
	expect(grid?.getAttribute("aria-readonly")).toBe("true");
	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"junio de 2026",
	);

	// Una fila de cabeceras y cinco semanas: junio de 2026 empieza en lunes y
	// son treinta días.
	expect(grid?.querySelectorAll('[role="row"]')).toHaveLength(6);
	expect(grid?.querySelectorAll('[role="columnheader"]')).toHaveLength(7);
	expect(cells(el)).toHaveLength(35);

	el.remove();
});

test("las columnas salen del locale y empiezan por el primer día de su semana", async () => {
	const el = await mount();
	const headers = [
		...(el.shadowRoot?.querySelectorAll('[role="columnheader"]') ?? []),
	];

	expect(headers[0]?.textContent).toContain("lunes");
	expect(headers[6]?.textContent).toContain("domingo");

	const american = await mount((view) => {
		view.locale = "en-US";
	});
	const other = [
		...(american.shadowRoot?.querySelectorAll('[role="columnheader"]') ?? []),
	];

	expect(other[0]?.textContent).toContain("Sunday");
	expect(american.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"June 2026",
	);

	el.remove();
	american.remove();
});

test("cada celda va etiquetada con la fecha completa", async () => {
	const el = await mount();

	expect(cells(el)[0]?.textContent).toContain("lunes, 1 de junio de 2026");
	expect(cells(el)[34]?.textContent).toContain("domingo, 5 de julio de 2026");

	el.remove();
});

test("hoy se marca con aria-current y sólo hoy", async () => {
	const el = await mount();
	const marked = cells(el).filter(
		(cell) => cell.getAttribute("aria-current") === "date",
	);

	expect(marked).toHaveLength(1);
	expect(marked[0]?.textContent).toContain("17 de junio de 2026");

	el.remove();
});

test("los eventos se pintan como entradas compactas en su día", async () => {
	const el = await mount();
	const tenth = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	expect(
		[...(tenth?.querySelectorAll("li") ?? [])].map((item) => item.textContent),
	).toEqual(["Feria del libro", "Sin fecha"]);

	// Y el que cruza el borde del mes también está en las celdas de relleno.
	const july = cells(el).find((cell) => cell.dataset["key"] === "20260701");
	expect(july?.textContent).toContain("Congreso");

	el.remove();
});

// ── Orden y hora en la celda (T49) ──────────────────────────────────────────

test("dos eventos con hora salen ordenados por hora dentro de la celda", async () => {
	const el = await mount((view) => {
		view.events = [
			event("1", "Tarde", "2026-06-10T18:00", undefined, false),
			event("2", "Temprano", "2026-06-10T09:00", undefined, false),
		];
	});
	const tenth = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	expect(
		[...(tenth?.querySelectorAll("li") ?? [])].map((item) => item.textContent),
	).toEqual(["9:00 Temprano", "18:00 Tarde"]);

	el.remove();
});

test("el orden se invierte cuando la vista pide el orden contrario", async () => {
	const el = await mount((view) => {
		view.events = [
			event("1", "Tarde", "2026-06-10T18:00", undefined, false),
			event("2", "Temprano", "2026-06-10T09:00", undefined, false),
		];
		view.sort = { field: "startDate", direction: "desc" };
	});
	const tenth = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	expect(
		[...(tenth?.querySelectorAll("li") ?? [])].map((item) => item.textContent),
	).toEqual(["18:00 Tarde", "9:00 Temprano"]);

	el.remove();
});

test("un evento de día completo no muestra ninguna hora en su celda", async () => {
	const el = await mount((view) => {
		view.events = [event("1", "Feria", "2026-06-10", undefined, true)];
	});
	const tenth = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	expect(tenth?.querySelector("li")?.textContent).toBe("Feria");

	el.remove();
});

test("un congreso de varios días sólo muestra la hora en el día en que empieza", async () => {
	const el = await mount((view) => {
		view.events = [
			event("1", "Congreso", "2026-06-10T09:00", "2026-06-12T18:00", false),
		];
		view.month = local("2026-06-15");
	});

	const start = cells(el).find((cell) => cell.dataset["key"] === "20260610");
	const middle = cells(el).find((cell) => cell.dataset["key"] === "20260611");
	const end = cells(el).find((cell) => cell.dataset["key"] === "20260612");

	expect(start?.querySelector("li")?.textContent).toBe("9:00 Congreso");
	expect(middle?.querySelector("li")?.textContent).toBe("Congreso");
	expect(end?.querySelector("li")?.textContent).toBe("Congreso");

	el.remove();
});

test("la rejilla es un único punto de tabulación", async () => {
	const el = await mount();

	expect(
		el.shadowRoot?.querySelectorAll('[role="gridcell"][tabindex="0"]'),
	).toHaveLength(1);
	expect(
		el.shadowRoot?.querySelectorAll('[role="gridcell"][tabindex="-1"]'),
	).toHaveLength(34);

	// Y arranca en hoy, que es lo que el usuario espera encontrar.
	expect(tabbable(el)?.dataset["key"]).toBe("20260617");

	el.remove();
});

test("las flechas mueven el foco por días y por semanas", async () => {
	const el = await mount();

	await press(el, "ArrowRight");
	expect(tabbable(el)?.dataset["key"]).toBe("20260618");
	expect(el.shadowRoot?.activeElement).toBe(tabbable(el));

	await press(el, "ArrowDown");
	expect(tabbable(el)?.dataset["key"]).toBe("20260625");

	await press(el, "ArrowLeft");
	expect(tabbable(el)?.dataset["key"]).toBe("20260624");

	await press(el, "ArrowUp");
	expect(tabbable(el)?.dataset["key"]).toBe("20260617");

	// Sigue habiendo un solo punto de tabulación después de moverse.
	expect(
		el.shadowRoot?.querySelectorAll('[role="gridcell"][tabindex="0"]'),
	).toHaveLength(1);

	el.remove();
});

test("pinchar en una celda se lleva allí el punto de tabulación", async () => {
	// Si no, tras pinchar el día 3 y salir y volver con el tabulador, el foco
	// reaparecería en otro día: el ratón y el teclado dejarían de coincidir.
	const el = await mount();
	const third = cells(el).find((cell) => cell.dataset["key"] === "20260603");

	third?.click();
	await el.updateComplete;

	expect(tabbable(el)?.dataset["key"]).toBe("20260603");

	el.remove();
});

test("pinchar el relleno de otro mes deja el foco donde dice el tabindex", async () => {
	// Es el fallo que encontró la revisión. La plantilla no lleva claves, así
	// que Lit reutiliza los nodos por posición: al saltar a julio, el nodo
	// pinchado seguía enfocado y ya contenía el 29. La flecha siguiente daba un
	// salto de veintisiete días sin explicación.
	const el = await mount();
	const filler = cells(el).find((cell) => cell.dataset["key"] === "20260701");

	filler?.click();
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"julio de 2026",
	);
	expect(tabbable(el)?.dataset["key"]).toBe("20260701");
	expect(el.shadowRoot?.activeElement).toBe(tabbable(el));

	await press(el, "ArrowRight");
	expect(tabbable(el)?.dataset["key"]).toBe("20260702");

	el.remove();
});

test("las teclas de la rejilla se consumen, y sólo ésas", async () => {
	// Sin `preventDefault()` las flechas desplazan la página y `Av Pág` la salta
	// entera mientras el foco se mueve por el calendario: dos cosas a la vez.
	const el = await mount();

	expect((await press(el, "ArrowRight")).defaultPrevented).toBe(true);
	expect((await press(el, "Home")).defaultPrevented).toBe(true);
	expect((await press(el, "PageDown")).defaultPrevented).toBe(true);

	// Una tecla que no es nuestra sigue su camino.
	expect((await press(el, "a")).defaultPrevented).toBe(false);

	el.remove();
});

test("una tecla con modificador no es nuestra", async () => {
	// `Control+Inicio` es «ir al principio del documento». Entrar por la rama de
	// `Inicio` se lo tragaría con `preventDefault()` y además movería el foco.
	const el = await mount();
	const before = tabbable(el)?.dataset["key"];

	const domEvent = await press(el, "Home", { ctrlKey: true });

	expect(domEvent.defaultPrevented).toBe(false);
	expect(tabbable(el)?.dataset["key"]).toBe(before);

	el.remove();
});

test("moverse dentro del mismo mes no anuncia nada", async () => {
	// Sin el guardián, el mes se anunciaría en cada pulsación: treinta
	// interrupciones para cruzar un mes con la flecha.
	const el = await mount();

	await press(el, "ArrowRight");
	await press(el, "ArrowDown");
	await press(el, "Home");

	expect(status(el)).toBe("");

	el.remove();
});

test("Inicio y Fin van a los extremos de la semana del locale", async () => {
	const el = await mount();

	// El 17 de junio de 2026 es miércoles; en español la semana va del 15 al 21.
	await press(el, "Home");
	expect(tabbable(el)?.dataset["key"]).toBe("20260615");

	await press(el, "End");
	expect(tabbable(el)?.dataset["key"]).toBe("20260621");

	el.remove();
});

test("Av Pág y Re Pág cambian de mes y lo anuncian", async () => {
	const el = await mount();

	expect(status(el)).toBe("");

	await press(el, "PageDown");
	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"julio de 2026",
	);
	expect(status(el)).toContain("julio de 2026");
	expect(tabbable(el)?.dataset["key"]).toBe("20260717");

	await press(el, "PageUp");
	expect(status(el)).toContain("junio de 2026");

	el.remove();
});

test("salirse del mes con una flecha arrastra el mes y lo anuncia", async () => {
	const el = await mount((view) => {
		view.today = local("2026-06-01");
	});

	expect(tabbable(el)?.dataset["key"]).toBe("20260601");

	await press(el, "ArrowLeft");
	expect(tabbable(el)?.dataset["key"]).toBe("20260531");
	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"mayo de 2026",
	);
	expect(status(el)).toContain("mayo de 2026");

	el.remove();
});

test("los botones cambian de mes sin robar el foco de la rejilla", async () => {
	const el = await mount();
	const buttons = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])];

	(buttons[1] as HTMLElement | undefined)?.click();
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"julio de 2026",
	);
	expect(status(el)).toContain("julio de 2026");
	expect(el.shadowRoot?.activeElement).not.toBe(tabbable(el));

	el.remove();
});

test("cambiar de mes por Av Pág recorta el día al último del destino", async () => {
	// Del 31 de enero, febrero no tiene 31. Sin recortar, `Date` desborda y el
	// foco se iría a marzo, saltándose el mes que el usuario pidió ver.
	const el = await mount((view) => {
		view.month = local("2026-01-15");
		view.today = local("2026-01-31");
	});

	await press(el, "PageDown");
	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"febrero de 2026",
	);
	expect(tabbable(el)?.dataset["key"]).toBe("20260228");

	el.remove();
});

test("un mes sin nada que ver por teclado sigue teniendo punto de tabulación", async () => {
	// Con `today` en otro año no hay celda de hoy: el foco itinerante tiene que
	// caer igualmente en algún sitio, o la rejilla se sale del recorrido.
	const el = await mount((view) => {
		view.today = local("2030-01-01");
	});

	expect(tabbable(el)?.dataset["key"]).toBe("20260601");

	el.remove();
});

test("a los eventos sin fecha se puede llegar, no sólo contarlos", async () => {
	// Contarlos y nada más los dejaba anunciados pero inalcanzables: el usuario
	// sabía que existían y no tenía forma de abrirlos desde el calendario.
	const el = await mount((view) => {
		view.events = [
			{
				id: "4",
				title: "Algún día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
				allDay: true,
				tags: [],
			},
			{
				id: "5",
				title: "Otro día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
				allDay: true,
				tags: [],
			},
		];
	});

	const detalle = el.shadowRoot?.querySelector(".undated");
	expect(detalle?.getAttribute("summary")).toContain("2");

	// Desplegado, porque es donde el usuario los alcanza de verdad.
	(detalle as HTMLElement & { open: boolean }).open = true;
	await el.updateComplete;
	await new Promise((listo) => requestAnimationFrame(() => listo(null)));

	const botones = [...(detalle?.querySelectorAll("wa-button") ?? [])];
	expect(botones.map((b) => b.textContent?.trim())).toEqual([
		"Algún día",
		"Otro día",
	]);

	// Y que ocupen sitio: encontrarlos con `querySelector` no prueba que se
	// puedan pulsar. Con la lista oculta, la aserción de arriba pasa igual.
	for (const boton of botones) {
		expect(boton.getBoundingClientRect().width).toBeGreaterThan(0);
	}

	el.remove();
});

test("elegir un evento sin fecha lo anuncia hacia fuera", async () => {
	// La rejilla no sabe qué hacer con un evento —abrir el editor es decisión de
	// quien la monta, y eso es T21— así que sólo lo dice.
	const el = await mount((view) => {
		view.events = [
			{
				id: "4",
				title: "Algún día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
				allDay: true,
				tags: [],
			},
		];
	});

	const recibidos: string[] = [];
	el.addEventListener("planu-event-picked", (event) => {
		recibidos.push((event as CustomEvent<{ title: string }>).detail.title);
	});

	el.shadowRoot?.querySelector<HTMLElement>(".undated wa-button")?.click();

	expect(recibidos).toEqual(["Algún día"]);
	el.remove();
});

test("sin eventos sin fecha no hay ni rastro del aviso", async () => {
	const el = await mount();
	expect(el.shadowRoot?.querySelector(".undated")).toBeNull();
	el.remove();
});
