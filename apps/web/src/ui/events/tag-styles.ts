import { css } from "lit";

/**
 * A tag's look, shared by the card and by the editor.
 *
 * It used to live only in the card, and the result was that the editor's
 * tags got painted with Web Awesome's default neutral: **4.42:1**, below
 * the 4.5:1 AA requires. axe found it in the e2e, not a visual review.
 *
 * The tag's name rotates the hue and nothing else. Lightness and chroma
 * are constant, so the contrast is the same for all ten and doesn't depend
 * on which word the user typed: measured across the full 360 hues, the
 * worst case is 8.03:1. These are the three properties `wa-tag` actually
 * reads, checked in its stylesheet and not assumed.
 *
 * No dark variant on purpose: Web Awesome's dark theme is opt-in via a
 * class and nobody sets it, so a system preference query would paint
 * black chips inside a light card.
 */
export const tagChipStyles = css`
	wa-tag {
		--wa-color-fill-quiet: oklch(0.94 0.045 var(--hue));
		--wa-color-on-quiet: oklch(0.38 0.08 var(--hue));
		--wa-color-border-normal: oklch(0.86 0.06 var(--hue));
	}
`;
