/**
 * Normalisation, suggestion and colour of tags.
 *
 * Lives in `domain/` because it depends on nothing: it is the same kind of
 * module as `filter-events.ts`. The editor, the filter and the card all just
 * call in here, so the three agree on what counts as a valid tag. Duplicating
 * the normalisation in each component is how you end up with `Concierto` and
 * `concierto` coexisting on the same event.
 */

/** Zero to ten tags per event (F6). */
export const MAX_TAGS = 10;

/**
 * Maximum per tag, in **UTF-16 units** — that is, whatever `String.length`
 * measures.
 *
 * It used to be measured in code points, and that was a three-layer bug:
 * `wa-input`'s `maxlength` counts UTF-16 units, and so does the `size()` in
 * the Firestore rules (checked against the emulator: 280 `a`s pass, 281 do
 * not; 140 emoji pass, 150 do not). Only this constant counted code points,
 * so ten tags of 24 emoji each — valid here — added up to 489 units, and the
 * rules rejected them with a "could not save" that explained nothing.
 *
 * With all three layers measuring the same thing, ten tags of 24 plus nine
 * separators come to 249, and the rules' aggregate cap is never legitimately
 * reached. The cost is that a tag made only of emoji fits twelve, not
 * twenty-four, which is exactly what the field already let you type.
 */
export const MAX_TAG_LENGTH = 24;

/**
 * A normalised tag, or `null` if the text does not amount to one.
 *
 * `null` is returned instead of trimming to 24 because truncating silently
 * mangles the word — "quarterly team retrospectives" would end up as
 * "quarterly team retrospect" — and the user has no way of knowing they saved
 * something else. The caller decides: the editor warns, `normalizeTags`
 * discards.
 *
 * Length is measured as `String.length`; the reason is in `MAX_TAG_LENGTH`.
 */
export function normalizeTag(raw: string): string | null {
	// Interior spaces are collapsed on top of trimming the ends: "morning
	// run" (two spaces) and "morning run" (one space) are the same tag to
	// the user, and without this deduplication would not merge them.
	const clean = raw.trim().replace(/\s+/gu, " ").toLowerCase();
	if (clean === "") return null;
	if (clean.length > MAX_TAG_LENGTH) return null;
	return clean;
}

/**
 * Normalises and deduplicates **without capping how many there are**,
 * preserving the first order of appearance.
 *
 * Kept separate from `normalizeTags` because the cardinality cap belongs to
 * the *per-event* contract, not to normalisation. Applying it to the user's
 * vocabulary — the union of the tags across all of their events, which has
 * no bound — truncated the list before it was even filtered, leaving
 * autocomplete blind past the eleventh known tag.
 */
function cleanTags(raw: readonly string[]): string[] {
	const output: string[] = [];
	const seen = new Set<string>();
	for (const input of raw) {
		const tag = normalizeTag(input);
		if (tag === null || seen.has(tag)) continue;
		seen.add(tag);
		output.push(tag);
	}
	return output;
}

/**
 * Normalises the tag list **for one event**: discards what is not valid,
 * deduplicates preserving the first order of appearance, and caps at
 * `MAX_TAGS`.
 *
 * This is the gate through which everything a person did not type passes —
 * what the AI proposes (T24), what a legacy document brings in — so it
 * discards silently instead of failing: an event with an impossible tag is
 * shown without it, not left unshown altogether.
 *
 * It is not a general-purpose sanitiser: the cap at `MAX_TAGS` only makes
 * sense over one event's tags. For an unbounded list, use `cleanTags`.
 */
export function normalizeTags(raw: readonly string[]): string[] {
	return cleanTags(raw).slice(0, MAX_TAGS);
}

/**
 * Hue in degrees (0–359) derived from the name, stable across reloads.
 *
 * Returns a hue and not a colour because contrast cannot depend on the hash:
 * whoever renders it fixes lightness and chroma from the theme tokens and
 * only rotates the hue, so all ten tags meet AA by construction rather than
 * by luck. Randomising lightness too is how you end up with an illegible
 * yellow tag on a white background.
 *
 * 32-bit FNV-1a: cheap, dependency-free and well distributed for short
 * strings. It is not cryptographic and does not need to be.
 */
export function tagHue(tag: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < tag.length; i++) {
		hash ^= tag.charCodeAt(i);
		// Multiplication by the prime 16777619 in unsigned 32-bit arithmetic.
		// `Math.imul` is what avoids losing precision past 2^53.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash % 360;
}

/**
 * Already-used tags that match what is being typed, for the editor's
 * autocomplete.
 *
 * Matches by substring and not just by prefix: with compound tags —
 * "classical music" — matching by prefix forces you to remember how it
 * starts. Tags
 * already applied are excluded: offering something that cannot be added is
 * noise.
 *
 * `known` is the user's vocabulary — the union of the tags across all of
 * their events — so it is sanitised with `cleanTags` and not `normalizeTags`:
 * the cap of ten belongs to the event, and applying it here trimmed the
 * vocabulary before it was even searched. The only thing bounded is how many
 * suggestions are offered, and `limit` already takes care of that.
 */
export function suggestTags(
	known: readonly string[],
	query: string,
	already: readonly string[] = [],
	limit = 5,
): string[] {
	const term = normalizeTag(query) ?? query.trim().toLowerCase();
	const chosen = new Set(already);

	return cleanTags(known)
		.filter((tag) => !chosen.has(tag) && (term === "" || tag.includes(term)))
		.sort((a, b) => {
			// What starts with the term goes before what merely contains it:
			// that is what the user is typing.
			const byPrefix = Number(b.startsWith(term)) - Number(a.startsWith(term));
			return byPrefix !== 0 ? byPrefix : a.localeCompare(b);
		})
		.slice(0, limit);
}

/**
 * What typing `raw` into an event's tag field does to `tags`.
 *
 * - `empty`: nothing was typed. An Enter on the empty field is a gesture,
 *   not an error, so nothing changes and nothing is said.
 * - `too-long`: there was text, but it doesn't amount to a tag. The caller
 *   warns and keeps the draft so the user can shorten it.
 * - `unchanged`: already there, or the event already has `MAX_TAGS`. The
 *   draft is consumed without a warning.
 * - `added`: `tags` with the normalised tag appended at the end.
 */
export type AddTagResult =
	| { kind: "empty" }
	| { kind: "too-long" }
	| { kind: "unchanged" }
	| { kind: "added"; tags: string[] };

export function addTag(tags: readonly string[], raw: string): AddTagResult {
	const tag = normalizeTag(raw);
	if (tag === null) {
		return { kind: raw.trim() === "" ? "empty" : "too-long" };
	}
	if (tags.includes(tag) || tags.length >= MAX_TAGS) {
		return { kind: "unchanged" };
	}
	return { kind: "added", tags: [...tags, tag] };
}

/** `tags` without `tag`; the others keep their order. */
export function removeTag(tags: readonly string[], tag: string): string[] {
	return tags.filter((each) => each !== tag);
}

/**
 * Every distinct tag across `events`, alphabetically.
 *
 * The tags on offer come from the events the user already has, not from a
 * separate collection: that way there's nothing to keep in sync and no
 * extra query to pay for.
 */
export function collectTags(
	events: readonly { tags: readonly string[] }[],
): string[] {
	return [...new Set(events.flatMap((event) => event.tags))].sort((a, b) =>
		a.localeCompare(b),
	);
}
