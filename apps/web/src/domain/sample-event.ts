import { msg } from "@lit/localize";
import type { PlanuEvent } from "../lib/types.js";

/**
 * A sample event, for whoever clicks "try a sample event" from the empty
 * state (T33). It's delivered as a draft — the same mechanism the editor
 * already uses for what the AI proposes (T24/T27) — so the user reviews it
 * and decides whether to save it: it never writes itself.
 *
 * A factory and not a module-level constant: `msg()` is evaluated when
 * called, and a value computed at import time would freeze the language of
 * the first render, same as `eventSchema()` already warns in
 * `lib/types.ts`.
 *
 * `now` comes in as a parameter and isn't read with `new Date()` inside:
 * it's an input, not an implementation detail, so the result can be
 * checked without depending on when the tests happen to run.
 */
export function sampleEventDraft(now: Date = new Date()): Partial<PlanuEvent> {
	// A week from now and not a fixed date: the view separates upcoming from
	// past by the current instant, so a fixed value would stop "looking"
	// upcoming as time passes. Same reasoning as `scripts/seed-emulator.js`.
	const startDate = new Date(now);
	startDate.setDate(startDate.getDate() + 7);
	startDate.setHours(19, 0, 0, 0);

	const endDate = new Date(startDate);
	endDate.setHours(21, 0, 0, 0);

	return {
		title: msg("Dinner with friends"),
		description: msg(
			"A sample event, so you can see how it looks. Change anything you like, then save it — or delete it once you are done.",
		),
		location: msg("At home"),
		startDate,
		endDate,
	};
}
