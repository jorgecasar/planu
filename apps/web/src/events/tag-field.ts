import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/icon/icon.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/tag/tag.js";
import { msg, str } from "@lit/localize";
import {
	css,
	html,
	nothing,
	type ReactiveControllerHost,
	type TemplateResult,
} from "lit";
import {
	addTag,
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTags,
	removeTag,
	suggestTags,
	tagHue,
} from "../domain/tags.js";
import { renderTagList } from "./tag-list.js";

type Host = Pick<ReactiveControllerHost, "requestUpdate">;

/** `error` is the channel for the whole dialog, not only for tags. */
export interface TagFieldOptions {
	getError: () => string;
	setError: (message: string) => void;
}

/**
 * The editor's tags field: the ones added and what's being typed. A
 * controller rather than an element, so its markup stays in the editor's
 * shadow root, where the editor's styles and its tests already reach it.
 */
export class TagField {
	/** Tags already added to this event, always normalized. */
	tags: string[] = [];

	/** What's currently being typed in the tag field. */
	draft = "";

	readonly #host: Host;
	readonly #options: TagFieldOptions;

	constructor(host: Host, options: TagFieldOptions) {
		this.#host = host;
		this.#options = options;
	}

	reset(tags: readonly string[]): void {
		this.tags = normalizeTags(tags);
		this.draft = "";
		this.#host.requestUpdate();
	}

	readonly onInput = (domEvent: globalThis.Event): void => {
		const source = domEvent.composedPath()[0] as HTMLInputElement | undefined;
		this.draft = source?.value ?? "";
		this.#host.requestUpdate();
	};

	/**
	 * Enter adds the tag instead of submitting the form.
	 *
	 * Without the `preventDefault` the editor would save half-typed every
	 * time someone confirms a tag, which is exactly the natural gesture.
	 *
	 * The comma **doesn't** separate, even though that's the habit. A tag
	 * can carry one —`normalizeTag` keeps it and the rules accept it, which
	 * is exactly why the separator there is the line break— so treating it
	 * as a separator would silently forbid a value the other two layers
	 * consider valid. And the field only announces Enter.
	 */
	readonly onKey = (domEvent: KeyboardEvent): void => {
		if (domEvent.key !== "Enter") return;
		domEvent.preventDefault();
		this.add(this.draft);
	};

	/** The rules live in `addTag()`; this only maps its outcome to the UI. */
	add(raw: string): void {
		const { getError, setError } = this.#options;
		const result = addTag(this.tags, raw);
		if (result.kind === "empty") return;
		if (result.kind === "too-long") {
			setError(lengthError());
			return;
		}
		this.draft = "";
		this.#host.requestUpdate();
		if (result.kind === "unchanged") return;
		this.tags = result.tags;
		if (getError() === lengthError()) setError("");
	}

	remove(tag: string): void {
		this.tags = removeTag(this.tags, tag);
		this.#host.requestUpdate();
	}

	/**
	 * Tags field: the ones added, what's being typed, and the suggestions.
	 *
	 * The suggestions are buttons and not a `datalist`: `wa-input` renders
	 * its `input` inside the shadow DOM, so a `<datalist>` from outside
	 * can't reach it. Buttons work with keyboard and screen reader without
	 * having to build a combobox by hand.
	 *
	 * `ai` paints the AI part at the end, told whether the field is full.
	 */
	render(knownTags: readonly string[], ai: (full: boolean) => TemplateResult) {
		const { tags, draft } = this;
		const suggestions = suggestTags(knownTags, draft, tags);
		const full = tags.length >= MAX_TAGS;

		return html`
			<div class="tags">
				<wa-input
					id="tag"
					label=${msg("Tags")}
					hint=${msg(str`Press Enter to add. Up to ${MAX_TAGS}.`)}
					maxlength=${MAX_TAG_LENGTH}
					enterkeyhint="enter"
					?disabled=${full}
					.value=${draft}
					@input=${this.onInput}
					@keydown=${this.onKey}
				></wa-input>

				${renderTagList(
					"chosen",
					msg("Chosen tags"),
					tags,
					(tag) =>
						html`
						<wa-tag size="small" style=${`--hue: ${tagHue(tag)}`}>${tag}</wa-tag>
						<wa-button
							type="button"
							size="small"
							appearance="plain"
							@click=${() => this.remove(tag)}
						>
							<wa-icon name="xmark" label=${msg(str`Remove tag ${tag}`)}></wa-icon>
						</wa-button>
					`,
				)}

				${
					full
						? nothing
						: renderTagList(
								"suggestions",
								msg("Suggested tags"),
								suggestions,
								(tag) => html`
									<wa-button
										type="button"
										size="small"
										appearance="outlined"
										@click=${() => this.add(tag)}
									>${tag}</wa-button>
								`,
							)
				}

				${ai(full)}
			</div>
		`;
	}
}

/** For the host's `styles`: the markup lives in the host's shadow root. */
export const tagFieldStyles = css`
	.tags {
		display: flex;
		flex-direction: column;
		gap: var(--wa-space-xs);
	}

	.tags ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--wa-space-2xs);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* The delete button that wa-tag ships with comes out with tabindex
	   -1, so someone navigating by keyboard can't remove a tag added by
	   mistake. A control of our own goes next to it, reachable with Tab. */
	.tags .chosen li {
		display: flex;
		align-items: center;
		gap: var(--wa-space-3xs);
	}
`;

/**
 * The length warning, in a single place.
 *
 * It's set and cleared by comparing it, because `error` is the channel
 * for the whole dialog: clearing it blindly when adding a tag would
 * also erase "The image could not be uploaded", and the user would lose
 * a warning about something they hadn't done anything to resolve.
 */
function lengthError(): string {
	return msg(str`A tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
}
