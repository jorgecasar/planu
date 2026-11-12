import { html, nothing, type TemplateResult } from "lit";

/**
 * A list of tags with an accessible name, or nothing if it's empty.
 *
 * The chosen ones and the suggested ones are the same structure with
 * different content; having them duplicated was the sure way for one
 * to end up with an `aria-label` and the other without.
 *
 * The content is typed with the `TemplateResult` that lit exports and
 * not with `unknown`: `unknown` admits a function that returns `void`
 * or a promise, and both compile and paint `undefined` or
 * `[object Promise]` without anyone noticing.
 */
export function renderTagList(
	className: string,
	label: string,
	tags: readonly string[],
	content: (tag: string) => TemplateResult,
) {
	if (tags.length === 0) return nothing;

	return html`<ul class=${className} aria-label=${label}>
		${tags.map((tag) => html`<li>${content(tag)}</li>`)}
	</ul>`;
}
