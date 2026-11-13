// The same three sheets `main.ts` loads: without `theme.css` the heading
// token falls back to the body family and the assertions would be vacuous.
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "./theme.css";
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
import type { StoredEvent } from "../lib/types.js";
import "../profile/profile-view.js";
import "../sharing/share-dialog.js";

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
 * context requests here, so `@consume` leaves them alone.
 */
async function mount(tag: string, fields: object): Promise<ShadowRoot> {
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

/** Every component that imports `typographyStyles`, and where its title is. */
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
	["planu-share-dialog", OWN, "h3"],
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
	},
);

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
