import { afterEach, expect, test, vi } from "vitest";
import "./ui/calendar/calendar-view.js";
import "./events/event-card.js";
import "./events/event-editor.js";
import type { StoredEvent } from "./domain/event.js";

/**
 * Web Awesome 3 deprecated `size="small"|"medium"|"large"` for `s`/`m`/`l`
 * and warns once per tag and value. Mounts the components that size their
 * controls and fails on any such warning in the console.
 */

const EVENT = {
	id: "e1",
	title: "Concert",
	description: "",
	location: "",
	imageUrl: "",
	userId: "u1",
	memberIds: ["u1"],
	roles: {},
	allDay: true,
	tags: ["music"],
	startDate: null,
	endDate: null,
} as unknown as StoredEvent;

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

test("no component triggers a Web Awesome size deprecation", async () => {
	const warn = vi.spyOn(console, "warn");

	const card = Object.assign(document.createElement("planu-event-card"), {
		event: EVENT,
	});
	const calendar = Object.assign(
		document.createElement("planu-calendar-view"),
		{
			events: [EVENT],
		},
	);
	const editor = Object.assign(document.createElement("planu-event-editor"), {
		event: EVENT,
		knownTags: ["music", "travel"],
		open: true,
	});
	document.body.append(card, calendar, editor);
	await Promise.all([card, calendar, editor].map((el) => el.updateComplete));

	// The sized controls really are on the page, or the check proves nothing.
	const shadows = [card, calendar, editor].map((el) => el.shadowRoot);
	const sized = shadows.flatMap((root) => [
		...(root?.querySelectorAll("wa-tag[size], wa-button[size]") ?? []),
	]);
	expect(sized.length).toBeGreaterThanOrEqual(4);
	await Promise.all(
		sized.map(
			(el) =>
				(el as Element & { updateComplete: Promise<unknown> }).updateComplete,
		),
	);

	const deprecations = warn.mock.calls
		.map((args) => String(args[0]))
		.filter((text) => /is deprecated/.test(text));
	expect(deprecations).toEqual([]);
});
