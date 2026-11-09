import type { OwnershipFilter } from "./filter-events.js";

/**
 * What the events listing has to show instead of (or as) the list.
 *
 * - `no-events`: the user has nothing at all; the way out is creating one.
 * - `none-shared` / `none-mine`: the inbox filter alone emptied the list.
 * - `no-match`: a search, tag or date filter emptied it.
 */
export type ListingState =
	| "error"
	| "loading"
	| "no-events"
	| "none-shared"
	| "none-mine"
	| "no-match"
	| "list";

export interface ListingInput {
	/** `undefined` while the events context isn't published yet. */
	status: "loading" | "ready" | "error" | undefined;
	total: number;
	visible: number;
	ownership: OwnershipFilter;
	/** See `isNarrowed`. */
	narrowed: boolean;
}

export function listingState(input: ListingInput): ListingState {
	// The error comes before anything else: without this, a permissions
	// or quota failure left the list empty and the user read "you don't
	// have any events yet", which is exactly the wrong conclusion.
	if (input.status === "error") return "error";

	// `undefined` (context not published yet) and `"loading"` both mean
	// the same thing here: Firestore may still be travelling through its
	// dynamic import, or the subscription's first snapshot may not have
	// arrived. Without this check the view would conclude "you don't have
	// any events yet" on every cold start, indistinguishable from a
	// genuinely empty list.
	if (input.status === undefined || input.status === "loading") {
		return "loading";
	}

	if (input.visible > 0) return "list";
	if (input.total === 0) return "no-events";

	// With the inbox narrowed, "no results" is explained by the filter that
	// actually caused it: telling someone who simply has nothing shared to
	// check their search sends them looking in the wrong place. Only when the
	// inbox filter is the sole cause: with a search on top, "you have not
	// created any events" would be plainly false.
	if (!input.narrowed && input.ownership === "shared") return "none-shared";
	if (!input.narrowed && input.ownership === "mine") return "none-mine";
	return "no-match";
}
