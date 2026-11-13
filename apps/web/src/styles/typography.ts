import { css } from "lit";

/**
 * Typography shared by every component that renders a heading.
 *
 * Web Awesome's native styles already give h1–h6 the heading family, but
 * they are a document stylesheet and stop at each shadow root, and every
 * heading in the app lives inside one. Without this module no element ever
 * asks for `--wa-font-family-heading`, so the browser never fetches Belleza
 * (`@font-face` is lazy) and all headings fall back to the body's Alegreya.
 *
 * `wa-dialog` renders its `label` in its own shadow root, with
 * `font-family: inherit`; its `title` part is the documented way in.
 */
export const typographyStyles = css`
	h1,
	h2,
	h3,
	wa-dialog::part(title) {
		font-family: var(--wa-font-family-heading);
	}
`;
