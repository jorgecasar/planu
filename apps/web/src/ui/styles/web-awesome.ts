import native from "@awesome.me/webawesome/dist/styles/native.css?inline";
import utilities from "@awesome.me/webawesome/dist/styles/utilities.css?inline";
import { css, unsafeCSS } from "lit";

/**
 * Web Awesome's native styles and CSS utilities, for shadow roots.
 *
 * `main.ts` loads both into the document, but a document stylesheet stops at
 * each shadow root and the whole app renders inside one: without this, `h2`
 * gets the browser's font instead of `--wa-font-family-heading`, `<a>` the
 * default blue, and `wa-stack` or `wa-cluster` no layout at all. Web Awesome
 * documents no way of its own to reach a shadow root, so every component adds
 * this group first in its `static styles`.
 *
 * Each `CSSResult` builds its `CSSStyleSheet` once and Lit adopts that same
 * object in every root, so the CSS is parsed once however many components
 * use it. The rules keep their `wa-native` and `wa-utilities` layers, so any
 * unlayered rule in a component still wins over them.
 *
 * The one local rule below has no native route. `wa-dialog` sets its title to
 * `font-family: inherit` and exposes no token for it, and a theme in the
 * document cannot select a part inside a component's shadow root, so the
 * documented `title` part is the only way in.
 *
 * `native.css` resets `*` to `box-sizing: inherit` and relies on `html` being
 * `border-box`; `planu-firebase-provider` keeps that chain unbroken.
 */
export const webAwesomeStyles = [
	unsafeCSS(native),
	unsafeCSS(utilities),
	css`
		wa-dialog::part(title) {
			font-family: var(--wa-font-family-heading);
		}
	`,
];
