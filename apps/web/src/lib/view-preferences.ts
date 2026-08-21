import {
	DEFAULT_SORT,
	parseSortPreference,
	type SortPreference,
	serializeSortPreference,
} from "../domain/sort-events.js";
import {
	DEFAULT_VIEW,
	parseViewMode,
	type ViewMode,
} from "../domain/view-mode.js";

/**
 * Own prefix to avoid clashing with anything else on the same origin, and a
 * suffix with the view it belongs to: a key called just `sort` wouldn't say
 * of what.
 */
const SORT_KEY = "planu.events.sort";

/** The chosen view —cards, calendar or agenda—, alongside the sort order's. */
const VIEW_KEY = "planu.events.view";

/**
 * Everything that decides what is valid lives in `domain/sort-events.ts`.
 * All that's left here is access to storage, which is the only part that
 * cannot be tested as a pure function.
 *
 * `storage` is optional and resolved **inside** the `try`, not as the
 * parameter's default value: in an iframe with storage denied, the mere act
 * of naming `localStorage` throws `SecurityError`, and evaluating it in the
 * signature would happen before entering the `try`. This way, a restrictive
 * browser loses the preference but not the listing.
 */
export function readSortPreference(storage?: Storage): SortPreference {
	try {
		return parseSortPreference((storage ?? localStorage).getItem(SORT_KEY));
	} catch {
		return { ...DEFAULT_SORT };
	}
}

/** Saving the preference is a convenience: if it fails, nothing is reported. */
export function writeSortPreference(
	preference: SortPreference,
	storage?: Storage,
): void {
	try {
		(storage ?? localStorage).setItem(
			SORT_KEY,
			serializeSortPreference(preference),
		);
	} catch {
		// Quota full or storage denied. The listing keeps working.
	}
}

/**
 * The view the user left set. What decides what is valid lives in
 * `domain/view-mode.ts`; all that's left here is access to storage.
 *
 * Same `try` as above and for the same reason: naming `localStorage` can
 * throw `SecurityError` before reading anything, and a restrictive browser
 * must lose the preference, not the screen.
 */
export function readViewMode(storage?: Storage): ViewMode {
	try {
		return parseViewMode((storage ?? localStorage).getItem(VIEW_KEY));
	} catch {
		return DEFAULT_VIEW;
	}
}

/** Saving the view is a convenience: if it fails, nothing is reported. */
export function writeViewMode(mode: ViewMode, storage?: Storage): void {
	try {
		(storage ?? localStorage).setItem(VIEW_KEY, mode);
	} catch {
		// Quota full or storage denied. The view keeps working.
	}
}
