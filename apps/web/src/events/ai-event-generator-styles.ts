import { css } from "lit";

/**
 * The stylesheet of `<planu-ai-event-generator>`, kept apart so the component
 * file holds only behaviour. The indentation inside the template is the one it
 * had inside the class, so the resulting `cssText` is byte-for-byte the same.
 */
export const aiEventGeneratorStyles = css`
		fieldset {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);
			margin: 0;
			padding: 0;
			border: none;
		}

		legend {
			padding: 0;
			font-weight: var(--wa-font-weight-semibold);
		}

		.drop {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);
		}

		img {
			inline-size: 100%;
			block-size: 12rem;
			object-fit: contain;
		}

		.working {
			display: flex;
			align-items: center;
			gap: var(--wa-space-s);
		}

		.working p {
			margin: 0;
		}

		.what {
			font-weight: var(--wa-font-weight-semibold);
		}

		.why {
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		.count {
			margin: 0;
			color: var(--wa-color-text-quiet);
			font-size: var(--wa-font-size-s);
		}

		.count[data-over] {
			color: var(--wa-color-danger-on-quiet);
		}

		.paste {
			display: flex;
			flex-direction: column;
			align-items: start;
			gap: var(--wa-space-s);
		}
	`;
