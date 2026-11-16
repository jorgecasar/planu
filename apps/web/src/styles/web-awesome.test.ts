// The same sheets `main.ts` loads: without the planu theme the heading
// token falls back to the body family and the assertions would be vacuous.
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "./theme-planu.css";
import "./fonts.css";
import type { CSSResult, LitElement } from "lit";
import { afterEach, expect, test } from "vitest";
import "../app-shell.js";
import type { SessionUser } from "../application/ports/session.js";
import { PROFILE_PATH } from "../auth/guard.js";
import "../auth/login-view.js";
import "../calendar/agenda-view.js";
import "../calendar/calendar-view.js";
import "../events/event-card.js";
import "../events/event-editor.js";
import "../events/event-groups.js";
import type { StoredEvent } from "../domain/event.js";
import "../ui/profile/profile-view.js";
import "../sharing/share-dialog.js";
import { webAwesomeStyles } from "./web-awesome.js";

// index.html puts the theme class on <html>; the test page has none.
document.documentElement.classList.add("wa-theme-planu", "wa-light");

const USER: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

const EVENT: StoredEvent = {
	id: "e1",
	title: "Concierto",
	description: "En el parque",
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
};

const HEADING = /^"?Belleza"?,/;
const BODY = /^"?Alegreya"?,/;

/**
 * Mounts a component with its fields set directly: no provider answers the
 * context requests here, so `@consume` leaves them alone. Others load on
 * demand: importing them all up front overflows the resource timing buffer.
 */
async function mount(tag: string, fields: object): Promise<ShadowRoot> {
	const component = COMPONENTS.find((c) => c.tag === tag);
	if (component) await loaders[component.path]?.();
	const el = document.createElement(tag) as HTMLElement & {
		updateComplete: Promise<boolean>;
	};
	Object.assign(el, fields);
	document.body.append(el);
	await el.updateComplete;
	if (!el.shadowRoot) throw new Error(`${tag} has no shadow root`);
	return el.shadowRoot;
}

function family(el: Element | null | undefined): string {
	if (!el) throw new Error("element not rendered");
	return getComputedStyle(el).fontFamily;
}

afterEach(() => {
	document.body.replaceChildren();
});

const OWN = { event: EVENT, user: USER };
const ONE = { upcoming: [], undated: [EVENT], past: [] };
/** A `wa-dialog` renders its label in its own shadow root. */
const DIALOG = "wa-dialog";

/** Every component that renders a title, and where it is. */
const HEADINGS: [string, object, string][] = [
	["planu-app", { user: USER }, "header h1"],
	["planu-login-view", {}, "h1"],
	["planu-profile-view", { user: USER }, "h2"],
	["planu-profile-view", { user: USER }, DIALOG],
	["planu-event-card", OWN, "h3"],
	["planu-event-card", OWN, DIALOG],
	["planu-event-groups", { groups: ONE }, "h2"],
	["planu-agenda-view", { agenda: ONE }, "h2"],
	["planu-calendar-view", { headingLevel: 2 }, "h2"],
	// The body only exists while the dialog is open (GH-206).
	["planu-share-dialog", { ...OWN, open: true }, "h3"],
	["planu-share-dialog", OWN, DIALOG],
	["planu-event-editor", { user: USER }, DIALOG],
];

test.each(HEADINGS)(
	"%s: %s %s uses the heading family",
	async (tag, fields, selector) => {
		// The router resolves the location on connect and rejects the test
		// runner's own URL; a signed-in user stays put on the profile route.
		window.history.pushState({}, "", PROFILE_PATH);
		const root = await mount(tag, fields);
		const heading =
			selector === DIALOG
				? root
						.querySelector(DIALOG)
						?.shadowRoot?.querySelector('[part="title"]')
				: root.querySelector(selector);
		expect(family(heading)).toMatch(HEADING);
		// Belleza ships only at 400: any other weight is painted as fake bold.
		expect(getComputedStyle(heading as Element).fontWeight).toBe("400");
	},
);

function faces(name: string): FontFace[] {
	return [...document.fonts].filter(
		(f) => f.family.replaceAll('"', "") === name,
	);
}

test("each family is a single face, and Belleza downloads once", async () => {
	const root = await mount("planu-event-card", { event: EVENT, user: USER });
	root.querySelector("h3")?.getBoundingClientRect();
	await document.fonts.ready;
	const belleza = faces("Belleza");
	expect(belleza).toHaveLength(1);
	expect(belleza[0]?.status).toBe("loaded");
	const alegreya = faces("Alegreya");
	expect(alegreya).toHaveLength(1);
	expect(alegreya[0]?.weight).toBe("400 700");
	const requests = performance
		.getEntriesByType("resource")
		.filter((e) => e.name.includes("belleza"));
	expect(requests).toHaveLength(1);
});

test("the card's text stays in the body family", async () => {
	const root = await mount("planu-event-card", { event: EVENT, user: USER });
	expect(family(root.querySelector("p"))).toMatch(BODY);
});

test("Belleza loads for the card's own title", async () => {
	const root = await mount("planu-event-card", { event: EVENT, user: USER });
	const h3 = root.querySelector("h3");
	if (!h3) throw new Error("no title");
	const { fontFamily, fontWeight } = getComputedStyle(h3);
	expect(fontFamily).toMatch(HEADING);
	// Layout is what makes the browser request a face; `ready` alone could
	// settle before anything was asked for.
	h3.getBoundingClientRect();
	await document.fonts.ready;
	// `check` is true only when the face this title resolves to is loaded.
	expect(document.fonts.check(`${fontWeight} 1em ${fontFamily}`)).toBe(true);
});

// Derived from the sources, so a component added tomorrow is held to the same
// rule without anyone remembering to list it here.
const rawLoaders = import.meta.glob(
	[
		"../**/*.ts",
		"!../**/*.test.ts",
		"!../generated/**",
		"!../infrastructure/**",
	],
	{ query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;
// Read after the static imports, and with room: the font test counts entries.
performance.setResourceTimingBufferSize(2000);
const sources = Object.fromEntries(
	await Promise.all(
		Object.entries(rawLoaders).map(async ([path, load]) => [
			path,
			await load(),
		]),
	),
) as Record<string, string>;
const loaders = import.meta.glob([
	"../**/*.ts",
	"!../**/*.test.ts",
	"!../generated/**",
	"!../infrastructure/**",
]) as Record<string, () => Promise<unknown>>;
const COMPONENTS = Object.entries(sources).flatMap(([path, source]) => {
	const tag = source.match(/@customElement\("(planu-[a-z-]+)"\)/)?.[1];
	return tag ? [{ path, tag, light: source.includes("createRenderRoot") }] : [];
});

test("the glob finds the components, light-DOM ones included", () => {
	expect(COMPONENTS.length).toBeGreaterThanOrEqual(15);
	expect(COMPONENTS.filter((c) => c.light).map((c) => c.tag)).toEqual([
		"planu-change-email-form",
	]);
});

// A light-DOM component renders into its host's shadow root, which already
// carries the sheets: it has no root, and no styles, of its own.
test.each(
	COMPONENTS.filter((c) => !c.light).map((c) => [c.tag, c.path] as const),
)("%s adopts the shared Web Awesome sheets", async (tag, path) => {
	await loaders[path]?.();
	const element = customElements.get(tag) as typeof LitElement | undefined;
	if (!element) throw new Error(`${tag} is not defined`);
	for (const sheet of webAwesomeStyles) {
		expect(element.elementStyles).toContain(sheet);
	}
});

test("every root adopts the very same sheet object, parsed once", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const card = await mount("planu-event-card", OWN);
	const profile = await mount("planu-profile-view", { user: USER });
	const [native] = webAwesomeStyles;
	if (!native?.styleSheet) throw new Error("no constructable sheet");
	expect(card.adoptedStyleSheets).toContain(native.styleSheet);
	expect(profile.adoptedStyleSheets).toContain(native.styleSheet);
	expect(card.adoptedStyleSheets[0]).toBe(profile.adoptedStyleSheets[0]);
});

/** Resolves a token in the document, where the theme defines it. */
function token(name: string): string {
	const probe = document.createElement("span");
	probe.style.color = `var(${name})`;
	document.body.append(probe);
	const value = getComputedStyle(probe).color;
	probe.remove();
	return value;
}

test("links inside a shadow root take Web Awesome's link colour", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const root = await mount("planu-profile-view", { user: USER });
	const links = root.querySelectorAll("a");
	expect(links.length).toBeGreaterThan(0);
	const link = token("--wa-color-text-link");
	// Not the browser's own `rgb(0, 0, 238)`.
	expect(link).not.toBe("rgb(0, 0, 238)");
	for (const a of links) expect(getComputedStyle(a).color).toBe(link);
});

test("wa-stack and wa-cluster lay out inside a shadow root", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const root = await mount("planu-profile-view", { user: USER });
	const stack = root.querySelector(".wa-stack");
	const cluster = root.querySelector(".wa-cluster");
	if (!stack || !cluster) throw new Error("no layout utilities rendered");
	const s = getComputedStyle(stack);
	const c = getComputedStyle(cluster);
	expect([s.display, s.flexDirection]).toEqual(["flex", "column"]);
	expect([c.display, c.flexWrap]).toEqual(["flex", "wrap"]);
});

test("wa-visually-hidden clips its text to one pixel inside a shadow root", async () => {
	const root = await mount("planu-calendar-view", { events: [EVENT] });
	const hidden = root.querySelectorAll(".wa-visually-hidden");
	expect(hidden.length).toBeGreaterThan(0);
	for (const el of hidden) {
		const style = getComputedStyle(el);
		expect([style.position, style.width, style.height]).toEqual([
			"absolute",
			"1px",
			"1px",
		]);
		expect(style.clipPath).not.toBe("none");
	}
});

test("every element in a root is border-box, the wa-* hosts included", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	// native.css's `*{box-sizing:inherit}` hands down what the provider's slot
	// computes; the shell wears the provider's own styles.
	const shell = document.createElement("div");
	const shadow = shell.attachShadow({ mode: "open" });
	const { PlanuFirebaseProvider } = await import(
		"../infrastructure/firebase/firebase-provider.js"
	);
	shadow.adoptedStyleSheets = [
		(PlanuFirebaseProvider.styles as CSSResult).styleSheet as CSSStyleSheet,
	];
	shadow.append(document.createElement("slot"));
	document.body.append(shell);
	const host = document.createElement("planu-profile-view") as LitElement;
	Object.assign(host, { user: USER });
	shell.append(host);
	await host.updateComplete;
	const root = host.shadowRoot;
	if (!root) throw new Error("no shadow root");
	// That rule also beats each wa-* host's own `:host{box-sizing:border-box}`.
	for (const selector of ["div", "p", "dl", "wa-button", "wa-card"]) {
		const el = root.querySelector(selector);
		if (!el) throw new Error(`no ${selector}`);
		expect(getComputedStyle(el).boxSizing, selector).toBe("border-box");
	}
});

const FRESH = { ...EVENT, tags: ["a"] };
const DATED = { ...EVENT, startDate: new Date(), endDate: new Date() };
const INVITE = {
	id: "i1",
	eventId: "e1",
	eventTitle: "Concierto",
	inviteeUid: "u1",
	invitedByName: "Ana",
	role: "viewer",
};

/** One `<ul class="wa-list-plain">` per component that renders a bare list. */
const LISTS: [string, object, object][] = [
	["planu-event-card", { event: FRESH, user: USER }, {}],
	["planu-share-dialog", { ...OWN, open: true }, {}],
	["planu-invitations-inbox", {}, { invites: [INVITE] }],
	["planu-calendar-view", { events: [EVENT] }, {}],
	[
		"planu-calendar-view",
		{ events: [DATED], month: new Date(), today: new Date() },
		{},
	],
];

test.each(LISTS)(
	"%s: its plain list has no native.css indent",
	async (tag, fields, patch) => {
		const root = await mount(tag, fields);
		const host = root.host as LitElement;
		Object.assign(host, patch);
		await host.updateComplete;
		const lists = root.querySelectorAll("ul");
		expect(lists.length).toBeGreaterThan(0);
		for (const ul of lists) {
			expect(ul.classList.contains("wa-list-plain")).toBe(true);
			const li = ul.querySelector("li");
			if (!li) throw new Error("list without items");
			expect(getComputedStyle(li).marginInlineStart).toBe("0px");
			expect(getComputedStyle(ul).listStyleType).toBe("none");
		}
	},
);

const px = (value: string) => Number.parseFloat(value);

// native.css zeroes a paragraph's margins and pads only its end, so every
// place that leaned on the browser's 1em top and bottom says so itself now.
test("the share dialog's empty note keeps a gap above and below", async () => {
	const root = await mount("planu-share-dialog", { ...OWN, open: true });
	const note = root.querySelector("p.empty");
	if (!note) throw new Error("no empty note");
	const { marginTop, marginBottom } = getComputedStyle(note);
	expect(px(marginTop)).toBeGreaterThan(0);
	expect(px(marginBottom)).toBeGreaterThan(0);
});

test("the AI generator's intro keeps a gap above and below", async () => {
	const root = await mount("planu-ai-event-generator", {});
	const intro = root.querySelector("fieldset > p");
	if (!intro) throw new Error("no intro");
	const { marginTop, marginBottom } = getComputedStyle(intro);
	expect(px(marginTop)).toBeGreaterThan(0);
	expect(marginBottom).toBe(marginTop);
});

test("the empty state keeps a gap around its paragraphs", async () => {
	const root = await mount("planu-empty-state", {});
	const paragraphs = [...root.querySelectorAll("p")];
	expect(paragraphs.length).toBe(3);
	for (const p of paragraphs) {
		expect(px(getComputedStyle(p).marginBottom)).toBeGreaterThan(0);
	}
	expect(
		px(getComputedStyle(paragraphs[0] as Element).marginTop),
	).toBeGreaterThan(0);
});

test("the delete-account dialog spaces its body with wa-stack", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const root = await mount("planu-profile-view", {
		user: USER,
		confirmingDelete: true,
	});
	const body = root.querySelector("wa-dialog > .wa-stack");
	if (!body) throw new Error("no stacked body");
	const style = getComputedStyle(body);
	expect([style.display, style.flexDirection]).toEqual(["flex", "column"]);
	expect(px(style.rowGap)).toBeGreaterThan(0);
	expect(body.querySelectorAll("p").length).toBe(2);
});

test("the reauthentication step spaces its body with wa-stack", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const root = await mount("planu-profile-view", {
		user: USER,
		confirmingDelete: true,
		needsReauth: true,
	});
	const body = root.querySelector("wa-dialog > .wa-stack");
	if (!body) throw new Error("no stacked body");
	expect(px(getComputedStyle(body).rowGap)).toBeGreaterThan(0);
	expect(body.querySelector("p")).not.toBeNull();
});

test("the listing's skeletons take the card's corners, not a pill", async () => {
	const root = await mount("planu-events-view", {});
	const skeleton = root.querySelector("wa-skeleton") as
		| (HTMLElement & { updateComplete: Promise<boolean> })
		| null;
	if (!skeleton) throw new Error("no skeleton while loading");
	await skeleton.updateComplete;
	const indicator = skeleton.shadowRoot?.querySelector('[part="indicator"]');
	if (!indicator) throw new Error("no indicator part");
	const probe = document.createElement("div");
	probe.style.borderRadius = "var(--wa-panel-border-radius)";
	document.body.append(probe);
	const card = getComputedStyle(probe).borderTopLeftRadius;
	expect(Number.parseFloat(card)).toBeGreaterThan(0);
	expect(getComputedStyle(indicator).borderTopLeftRadius).toBe(card);
});

test("signing out is not dressed as the destructive action", async () => {
	window.history.pushState({}, "", PROFILE_PATH);
	const root = await mount("planu-profile-view", { user: USER });
	const buttons = [...root.querySelectorAll("wa-button")];
	const variant = (label: string) =>
		buttons
			.find((b) => b.textContent?.trim() === label)
			?.getAttribute("variant");
	expect(variant("Sign out")).toBe("neutral");
	expect(variant("Delete account")).toBe("danger");
});

test("the cover's file input is themed by native.css, not the browser", async () => {
	const root = await mount("planu-event-editor", { user: USER, open: true });
	const input = root.querySelector('input[type="file"]');
	if (!input) throw new Error("no file input");
	expect(family(input)).toMatch(BODY);
	const button = getComputedStyle(input, "::file-selector-button");
	expect(button.fontFamily).toMatch(BODY);
	// Web Awesome's form-control height and pill radius, both from tokens.
	expect(button.borderTopLeftRadius).not.toBe("0px");
	expect(Number.parseFloat(button.height)).toBeGreaterThan(30);
});
