// The Web Awesome theme, same as `main.ts` loads it. Without it no `--wa-*`
// token resolves, backgrounds stay transparent and axe can't compute
// contrast: it returns nodes in `incomplete`, and "zero violations" actually
// means "I couldn't check".
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
 * An event that has **ended**, with its end declared.
 *
 * Giving it a start in the past isn't enough: since `groupOf` respects the
 * calendar's semantics, an event with no declared end stays ongoing forever.
 * Saying "past" requires saying when it ended.
 */
function past(id: string, title: string, day: string): StoredEvent {
	return event(id, title, day, day);
}

const EMPTY: Agenda<StoredEvent> = { upcoming: [], undated: [], past: [] };

/** The agenda exactly as the events view builds it, no shortcuts. */
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
 * The headings that **actually** reach the accessibility tree.
 *
 * `querySelectorAll("h2")` finds them even if they're `aria-hidden` or have no
 * box, and with that a mutant that removes them from the tree leaves the test
 * green. Finding a node doesn't prove it's announced.
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
	// h1 planu → h2 day → h3 card. With h2 in the card the event would end up
	// at the same level as its day, and navigating by headings wouldn't give
	// any structure.
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
	// `querySelectorAll` finds them even if the list is hidden: a mutant that
	// sets `display: none` on `.day-events` would leave a test that only
	// counts them green.
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
	// Folded, its headings aren't in the tree: that's what's expected of a
	// closed fold, and the reason for checking `checkVisibility` rather than
	// the DOM.
	expect(headings(el)).toEqual(["sábado, 20 de junio de 2026"]);
	el.remove();
});

test("los días pasados salen abiertos si son lo único que hay", async () => {
	// With the fold closed this screen shows neither a card nor a message:
	// just an accordion strip.
	const el = await mount((view) => {
		view.agenda = agenda([past("1", "Feria", "2026-06-01")]);
	});

	expect(details(el)?.open).toBe(true);
	expect(headings(el)).toEqual(["lunes, 1 de junio de 2026"]);
	el.remove();
});

test("el pliegue se abre por el atributo, que es como lo usa la vista", async () => {
	// The events view passes it with `?narrowed=${...}`, that is, by
	// **attribute**, and the attribute arrives empty. Without `type: Boolean`
	// the property would be `""` —falsy— and the fold would never open.
	// Assigning the property, which is the convenient thing in a test, takes
	// the one path production doesn't use.
	//
	// And the scenario is built so that **only** this rule explains the
	// result: there's an upcoming day, so the other opening trigger —"it's
	// the only thing there is"— can't open it.
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
	// The opposite case from the one above: `narrowed` can't invent a fold.
	const el = await mount((view) => {
		view.agenda = agenda([event("1", "Taller", "2026-06-20")]);
		view.narrowed = true;
	});

	expect(details(el)).toBeNull();
	el.remove();
});

/**
 * What's visible from top to bottom: headings and the fold, in document
 * order. The fold is named separately so the assertion reads well.
 */
const outline = (el: PlanuAgendaView) =>
	[...(el.shadowRoot?.querySelectorAll("h2, wa-details") ?? [])].map((node) =>
		node.localName === "wa-details" ? "pliegue" : node.textContent?.trim(),
	);

test("lo plegado va al final y los sin fecha en medio", async () => {
	// The invariant is written in `event-groups.ts`: the ones without a date
	// stay in the middle **so that the folded part remains the last thing on
	// the page**. Swapping the two blocks left the suite green.
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
	// With no upcoming events but with undated events, the screen already
	// shows something, so the fold stays closed — that's what `event-groups`
	// does and what `shouldRevealPast` says. Passing it `undated: 0` used to
	// open it, and no test built this shape: it takes `upcoming` being empty
	// and `undated` not being empty.
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
	// It's the accessible name of the `<summary role="button">`, not
	// decoration. And counting days would say "Show 1 past events" with two
	// fairs on the same day.
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
	// The fold names the control, not the day. Without headings inside,
	// opening it would leave a strip of cards with no structure to navigate
	// by.
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
	// F5's acceptance criteria asks for axe on each of the three views. Here
	// and not only in the e2e: this way the oracle runs on every `npm test`.
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
	// `incomplete` means "I couldn't check". Without the theme loaded the
	// backgrounds are `rgba(0,0,0,0)` and axe returns "background color could
	// not be determined": exactly the rule most likely to break here would go
	// unchecked. It's scoped to the day headings, which is what this view
	// adds: the cards are already measured by `events.spec.ts`.
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
	// Without this, scoping to a selector that finds nothing would give both
	// lists empty: "no violations" and "not checked" look the same.
	expect(results.passes.length).toBeGreaterThan(0);

	el.remove();
});
