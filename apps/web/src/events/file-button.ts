import "@awesome.me/webawesome/dist/components/button/button.js";
import { msg } from "@lit/localize";
import { css, html } from "lit";

export interface FileButtonOptions {
	/** The input's id, which the caller's `<label for>` points at. */
	id: string;
	accept: string;
	disabled: boolean;
	onChange: (event: Event) => void;
}

/**
 * A file picker that looks like the rest of the app.
 *
 * The native `<input type="file">` stays the real control: it keeps the
 * caller's `<label for>`, its place in the tab order and its `change`
 * event, so neither assistive technology nor the upload code notice any
 * difference. It is only hidden from sight, and the `wa-button` is its
 * visible face: out of the tab order, so the keyboard reaches the control
 * once, and the input's focus ring is drawn on it. Not `aria-hidden`: the
 * button stays focusable by pointer, and axe rightly flags hidden content
 * that can take focus.
 */
export function renderFileButton(options: FileButtonOptions) {
	const { id, accept, disabled, onChange } = options;
	return html`
		<input
			id=${id}
			class="file-input"
			type="file"
			accept=${accept}
			?disabled=${disabled}
			@change=${onChange}
		/>
		<wa-button
			class="file-button"
			type="button"
			appearance="outlined"
			tabindex="-1"
			?disabled=${disabled}
			@click=${(event: Event) => {
				const button = event.currentTarget as HTMLElement;
				(button.previousElementSibling as HTMLInputElement | null)?.click();
			}}
		>
			${msg("Choose image")}
		</wa-button>
	`;
}

export const fileButtonStyles = css`
	/* Same as Web Awesome's .wa-visually-hidden-force, which cannot reach a
	   shadow root. */
	.file-input {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
		border: none;
		padding: 0;
	}

	.file-button {
		align-self: start;
	}

	.file-input:focus-visible + .file-button::part(button) {
		outline: var(--wa-focus-ring);
		outline-offset: var(--wa-focus-ring-offset);
	}
`;
