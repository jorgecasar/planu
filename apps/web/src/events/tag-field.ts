import { msg, str } from "@lit/localize";
import type { ReactiveControllerHost } from "lit";
import {
	addTag,
	MAX_TAG_LENGTH,
	normalizeTags,
	removeTag,
} from "../domain/tags.js";

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
}

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
