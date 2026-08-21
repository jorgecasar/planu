// The Web Awesome theme, same as `main.ts` loads it. Without it no `--wa-*`
// token resolves, backgrounds stay transparent and axe can't compute
// contrast: it used to return two nodes in `incomplete` —"background color
// could not be determined"— and the rule most likely to break here was being
// tested against a color nobody will ever see.
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

function event(id: string, title: string, start: string, end?: string) {
	return {
		id,
		title,
		startDate: local(start),
		endDate: end ? local(end) : null,
		memberIds: [],
		roles: {},
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

/** The cell that has the roving focus. */
function tabbable(el: PlanuCalendarView): HTMLElement | null {
	return (
		el.shadowRoot?.querySelector<HTMLElement>(
			'[role="gridcell"][tabindex="0"]',
		) ?? null
	);
}

/**
 * Presses a key on the cell that currently has focus and returns the event,
 * so you can check whether it was consumed.
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
 * An element's accessible name, computed by axe.
 *
 * `textContent` doesn't work for this: it's blind to `aria-hidden` and to
 * whether the text has a box. A `display: none` on the hidden text leaves the
 * cell without a name, and `textContent` doesn't notice.
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
	// F5's acceptance criteria asks for axe on the view, and a date grid is
	// where axe finds problems. Here and not only in the e2e: this way the
	// oracle runs on every `npm test` instead of waiting for a pass that comes
	// late.
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
	// `incomplete` means "I couldn't check", and it used to be silently
	// dismissed: without the theme loaded, the cells' background was
	// `rgba(0,0,0,0)` and axe returned "background color could not be
	// determined". Contrast is exactly what depends on tokens here —the
	// filler day and the event chip— so both lists are checked.
	//
	// The pass runs on the grid and not on the whole component because the
	// two toolbar `wa-button`s return "overlapped by another element" due to
	// their own internal structure: that's on Web Awesome, not on T20.
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
	// The acceptance criterion is "cells labeled with the full date", and
	// `textContent` doesn't measure that: with the date hidden via
	// `display: none` the node still has text but the cell ends up without an
	// accessible name. This test compares the computed name, which is what
	// the user hears.
	const el = await mount();
	const empty = cells(el).find((cell) => cell.dataset["key"] === "20260602");
	const busy = cells(el).find((cell) => cell.dataset["key"] === "20260610");

	// Without events, the name is the date and nothing else: the day number
	// carries `aria-hidden` so it isn't repeated afterward.
	expect(accessibleName(empty as Element)).toBe("martes, 2 de junio de 2026");

	// With events, the date first and the titles after.
	expect(accessibleName(busy as Element)).toBe(
		"miércoles, 10 de junio de 2026 Feria del libro Sin fecha",
	);

	el.remove();
});

test("por defecto el título del mes no es un encabezado", async () => {
	// The level depends on where the grid is mounted, so fixing it here would
	// break the heading order of any page other than the one it was designed
	// for. Without a level, it's a paragraph and names the grid via
	// `aria-labelledby`.
	const el = await mount();

	expect(el.shadowRoot?.querySelector("#month-title")?.localName).toBe("p");
	el.remove();
});

test("el nivel del encabezado llega por atributo, que es como lo monta la vista", async () => {
	// The events view passes it as `heading-level="2"`, that is, by
	// **attribute**: without `type: Number` the property would hold the
	// string `"2"`, the `switch` would fall to the default case, and the
	// month would stay a paragraph, outside heading navigation. Assigning the
	// property wouldn't test that.
	const el = await mount();
	el.setAttribute("heading-level", "2");
	await el.updateComplete;

	const title = el.shadowRoot?.querySelector("#month-title");
	expect(title?.localName).toBe("h2");
	expect(accessibleName(title as Element)).toBe("junio de 2026");

	// And it still names the grid: the `id` is what labels it.
	expect(
		el.shadowRoot
			?.querySelector('[role="grid"]')
			?.getAttribute("aria-labelledby"),
	).toBe("month-title");

	el.remove();
});

test("las siete columnas se alinean de verdad", async () => {
	// The rows carry `display: contents` so that the cells become children of
	// the CSS grid. Without that —with `display: block`, for example— the
	// roles are still there and all the ARIA tests pass, but the calendar
	// gets painted as a single column. The geometry is what's checked, since
	// that's what breaks.
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
	// Cells aren't edited from here, and saying so keeps a screen reader from
	// offering an editing mode that doesn't exist.
	expect(grid?.getAttribute("aria-readonly")).toBe("true");
	expect(el.shadowRoot?.querySelector("#month-title")?.textContent).toBe(
		"junio de 2026",
	);

	// One header row and five weeks: June 2026 starts on a Monday and has
	// thirty days.
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

	// And the one that crosses the month's edge is also in the filler cells.
	const july = cells(el).find((cell) => cell.dataset["key"] === "20260701");
	expect(july?.textContent).toContain("Congreso");

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

	// And it starts on today, which is what the user expects to find.
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

	// There's still a single tab stop after moving.
	expect(
		el.shadowRoot?.querySelectorAll('[role="gridcell"][tabindex="0"]'),
	).toHaveLength(1);

	el.remove();
});

test("pinchar en una celda se lleva allí el punto de tabulación", async () => {
	// Otherwise, after clicking day 3 and tabbing away and back, the focus
	// would reappear on a different day: the mouse and the keyboard would
	// stop agreeing.
	const el = await mount();
	const third = cells(el).find((cell) => cell.dataset["key"] === "20260603");

	third?.click();
	await el.updateComplete;

	expect(tabbable(el)?.dataset["key"]).toBe("20260603");

	el.remove();
});

test("pinchar el relleno de otro mes deja el foco donde dice el tabindex", async () => {
	// This is the bug the review found. The template doesn't carry keys, so
	// Lit reuses nodes by position: when jumping to July, the clicked node
	// stayed focused but already held the 29th. The next arrow key made an
	// unexplained twenty-seven-day jump.
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
	// Without `preventDefault()` the arrows scroll the page and `Page Down`
	// skips it entirely while the focus moves through the calendar: two
	// things at once.
	const el = await mount();

	expect((await press(el, "ArrowRight")).defaultPrevented).toBe(true);
	expect((await press(el, "Home")).defaultPrevented).toBe(true);
	expect((await press(el, "PageDown")).defaultPrevented).toBe(true);

	// A key that isn't ours goes on its way.
	expect((await press(el, "a")).defaultPrevented).toBe(false);

	el.remove();
});

test("una tecla con modificador no es nuestra", async () => {
	// `Ctrl+Home` means "go to the start of the document". Going through the
	// `Home` branch would swallow it with `preventDefault()` and would also
	// move the focus.
	const el = await mount();
	const before = tabbable(el)?.dataset["key"];

	const domEvent = await press(el, "Home", { ctrlKey: true });

	expect(domEvent.defaultPrevented).toBe(false);
	expect(tabbable(el)?.dataset["key"]).toBe(before);

	el.remove();
});

test("moverse dentro del mismo mes no anuncia nada", async () => {
	// Without the guard, the month would be announced on every keystroke:
	// thirty interruptions to cross a month with the arrow key.
	const el = await mount();

	await press(el, "ArrowRight");
	await press(el, "ArrowDown");
	await press(el, "Home");

	expect(status(el)).toBe("");

	el.remove();
});

test("Inicio y Fin van a los extremos de la semana del locale", async () => {
	const el = await mount();

	// June 17, 2026 is a Wednesday; in Spanish the week runs from the 15th to
	// the 21st.
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
	// From January 31, February doesn't have 31 days. Without clamping,
	// `Date` overflows and the focus would go to March, skipping past the
	// month the user asked to see.
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
	// With `today` in another year there's no cell for today: the roving
	// focus still has to land somewhere, or the grid falls outside the tab
	// order.
	const el = await mount((view) => {
		view.today = local("2030-01-01");
	});

	expect(tabbable(el)?.dataset["key"]).toBe("20260601");

	el.remove();
});

test("a los eventos sin fecha se puede llegar, no sólo contarlos", async () => {
	// Just counting them left them announced but unreachable: the user knew
	// they existed and had no way to open them from the calendar.
	const el = await mount((view) => {
		view.events = [
			{
				id: "4",
				title: "Algún día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
				tags: [],
			},
			{
				id: "5",
				title: "Otro día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
				tags: [],
			},
		];
	});

	const detalle = el.shadowRoot?.querySelector(".undated");
	expect(detalle?.getAttribute("summary")).toContain("2");

	// Expanded, because that's where the user actually reaches them.
	(detalle as HTMLElement & { open: boolean }).open = true;
	await el.updateComplete;
	await new Promise((listo) => requestAnimationFrame(() => listo(null)));

	const botones = [...(detalle?.querySelectorAll("wa-button") ?? [])];
	expect(botones.map((b) => b.textContent?.trim())).toEqual([
		"Algún día",
		"Otro día",
	]);

	// And that they take up space: finding them with `querySelector` doesn't
	// prove they can be clicked. With the list hidden, the assertion above
	// would still pass.
	for (const boton of botones) {
		expect(boton.getBoundingClientRect().width).toBeGreaterThan(0);
	}

	el.remove();
});

test("elegir un evento sin fecha lo anuncia hacia fuera", async () => {
	// The grid doesn't know what to do with an event —opening the editor is a
	// decision for whoever mounts it, and that's T21— so it just says so.
	const el = await mount((view) => {
		view.events = [
			{
				id: "4",
				title: "Algún día",
				startDate: null,
				endDate: null,
				memberIds: [],
				roles: {},
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
