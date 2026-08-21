import { msg } from "@lit/localize";

/**
 * The three ways of looking at the same events.
 *
 * They're a **presentation**, not a filter: all three receive exactly the
 * same list, the one `filterEvents` returns. If a view ever had to query
 * something else, it would stop being a view mode and become a different
 * screen.
 */
export type ViewMode = "grid" | "calendar" | "agenda";

/**
 * The card grid: it's the one that existed before the switcher, so anyone
 * who never touches it sees the same thing they used to see.
 */
export const DEFAULT_VIEW = "grid" as const satisfies ViewMode;

/**
 * The views the switcher offers, **and the only ones accepted when reading
 * the saved preference**.
 *
 * A single list, for the same reason as in `sort-events.ts`: the controls'
 * `value`s and what gets validated when reading from `localStorage` have to
 * be the same thing, or changing one leaves the switcher with no option
 * marked and nobody notices.
 */
const OFFERED = [
	{ value: "grid", label: () => msg("Cards") },
	{ value: "calendar", label: () => msg("Calendar") },
	{ value: "agenda", label: () => msg("Agenda") },
] as const satisfies readonly { value: ViewMode; label: () => string }[];

export const OFFERED_VIEWS: readonly ViewMode[] = OFFERED.map(
	(entry) => entry.value,
);

/**
 * Reads what was saved, without trusting it.
 *
 * Garbage, `null`, or the name of a view that no longer exists all fall
 * back to the grid. A corrupt preference can't leave the screen without any
 * view at all.
 */
export function parseViewMode(raw: string | null | undefined): ViewMode {
	return OFFERED_VIEWS.find((mode) => mode === raw) ?? DEFAULT_VIEW;
}

/** An entry in the switcher, already with its translated label. */
export interface ViewOption {
	value: ViewMode;
	label: string;
}

/**
 * A factory, not a constant: `msg()` is evaluated when it's called, so a
 * list built at module-import time would freeze the language of that
 * instant.
 */
export function viewOptions(): ViewOption[] {
	return OFFERED.map(({ value, label }) => ({ value, label: label() }));
}
