import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import { msg } from "@lit/localize";
import {
	html,
	nothing,
	type ReactiveController,
	type ReactiveControllerHost,
} from "lit";
import type { AiModelPort } from "../application/ports/ai-model.js";
import type { SessionUser } from "../application/ports/session.js";
import { createAiModelSession, type TokenClaims } from "./ai-model-session.js";
import { suggestTagsWithAi, TAG_SUGGESTION_SCHEMA } from "./suggest-tags.js";
import { renderTagList } from "./tag-list.js";

/** What the model is shown, read at the moment it's about to be asked. */
export interface TagSuggestionInput {
	title: string;
	description: string;
	location: string;
	knownTags: readonly string[];
	/** The ones already on this event aren't proposed again. */
	chosenTags: readonly string[];
}

/** What the tags field hands over to paint the AI part of it. */
export interface TagSuggestionView {
	available: boolean;
	/** No room for another tag: the button stays, disabled. */
	full: boolean;
	onSuggest: () => void;
	onAccept: (tag: string) => void;
}

export interface TagSuggestionOptions {
	getAiModel: () => AiModelPort | undefined;
	getUser: () => SessionUser | null | undefined;
}

/**
 * The state behind "Suggest tags with AI" (T24): the request in flight, the
 * model download and the up to three tags it proposed. They appear
 * unchecked and are never applied on their own.
 *
 * The editor is one instance reused across events, never unmounted, so a
 * suggestion asked for one event must not apply if the editor closed and
 * reopened meanwhile. Each response checks the generation it was asked
 * under; `invalidate()` and `reset()` move it on. A review found this bug in
 * the earlier design —the two-phase save gate— before this button.
 */
export class TagSuggestionController implements ReactiveController {
	readonly #host: ReactiveControllerHost;
	readonly #options: TagSuggestionOptions;
	#session: ReturnType<typeof createAiModelSession> | undefined;
	#generation = 0;

	#suggested: string[] = [];
	#suggesting = false;
	#downloading = false;
	#progress = 0;

	constructor(host: ReactiveControllerHost, options: TagSuggestionOptions) {
		this.#host = host;
		this.#options = options;
		host.addController(this);
	}

	/** No lifecycle work: the editor never unmounts; closing invalidates. */
	hostConnected(): void {}

	/** The tags the AI proposed and the user hasn't accepted yet. */
	get suggested(): readonly string[] {
		return this.#suggested;
	}

	set suggested(tags: readonly string[]) {
		this.#suggested = [...tags];
		this.#host.requestUpdate();
	}

	get suggesting(): boolean {
		return this.#suggesting;
	}

	/**
	 * Whether the wait includes downloading the model, which can take
	 * minutes the first time: the button says so, or it would look frozen.
	 */
	get downloading(): boolean {
		return this.#downloading;
	}

	get progress(): number {
		return this.#progress;
	}

	/** Any request still thinking will be discarded when it answers. */
	invalidate(): void {
		this.#generation++;
	}

	/** A fresh start for a newly opened event; also counts as a close. */
	reset(): void {
		this.invalidate();
		this.#suggested = [];
		this.#suggesting = false;
		this.#downloading = false;
		this.#progress = 0;
		this.#host.requestUpdate();
	}

	/** Accepting one doesn't take the others away with it. */
	accept(tag: string): void {
		this.suggested = this.#suggested.filter((each) => each !== tag);
	}

	/** Up to three tags; `read` runs after the download, on what's written then. */
	async suggest(read: () => TagSuggestionInput): Promise<void> {
		const aiModel = this.#options.getAiModel();
		if (!aiModel) return;

		const token = this.#generation;
		const current = () => token === this.#generation;
		this.#suggesting = true;
		this.#host.requestUpdate();
		try {
			// Clicking is an explicit request, so a first-time download is fine.
			await this.#tagSession(aiModel).warmUp((percent) => {
				if (!current()) return;
				this.#downloading = true;
				this.#progress = percent;
				this.#host.requestUpdate();
			});
			if (!current()) return;
			this.#downloading = false;
			this.#host.requestUpdate();

			const suggestions = await suggestTagsWithAi(
				(parts) =>
					this.#tagSession(aiModel)
						.generate(parts)
						.then((response) => response.text),
				read(),
			);

			if (!current()) return;
			this.suggested = suggestions;
		} catch {
			// Only a failed `warmUp()` (an interrupted download) lands here;
			// silence, as in `suggestTagsWithAi()`: nobody asked beyond "try it".
		} finally {
			if (current()) {
				this.#suggesting = false;
				this.#downloading = false;
				this.#host.requestUpdate();
			}
		}
	}

	/** The button, the download's progress and what the AI proposed. */
	render({ available, full, onSuggest, onAccept }: TagSuggestionView) {
		return html`
			<!-- The button is deliberately explicit: automatic on typing
			     would require a debounce with cancellation, and tying it to
			     save —the earlier design— let a suggestion in flight apply
			     to a different event if the editor reopened in the
			     meantime. Hidden entirely without AI, just like "Generate
			     with AI": a button that always fails is worse than no
			     button. -->
			${
				available
					? html`<wa-button
							type="button"
							size="small"
							appearance="outlined"
							?disabled=${this.#suggesting || full}
							@click=${onSuggest}
						>
							${
								this.#downloading
									? msg("Downloading the AI model…")
									: this.#suggesting
										? msg("Suggesting tags…")
										: msg("Suggest tags with AI")
							}
						</wa-button>`
					: nothing
			}
			${
				this.#downloading
					? html`<wa-progress-bar
							value=${this.#progress}
						></wa-progress-bar>`
					: nothing
			}

			<!-- Deliberately distinct from "Suggested tags": that one
			     filters the known vocabulary by what's being typed; this
			     one is proposed by the AI when the button above is
			     clicked, and conflating the two sections would be worse
			     than keeping them separate. -->
			${renderTagList(
				"ai-suggestions",
				msg("Tags suggested by AI"),
				this.#suggested,
				(tag) => html`
					<wa-button
						type="button"
						size="small"
						appearance="outlined"
						@click=${() => onAccept(tag)}
					>${tag}</wa-button>
				`,
			)}
		`;
	}

	/**
	 * `getIdTokenResult` is optional on `SessionUser`; without it there's no
	 * claim to read, which cloud AI treats as "not premium", the safe default.
	 */
	#claims(): TokenClaims | null {
		const getIdTokenResult = this.#options.getUser()?.getIdTokenResult;
		return getIdTokenResult ? { getIdTokenResult } : null;
	}

	/** Lazy: creating it doesn't download anything on its own. */
	#tagSession(aiModel: AiModelPort) {
		// Text only: unlike the event generator, there's no image to analyze.
		this.#session ??= createAiModelSession({
			getUser: () => this.#claims(),
			buildModel: (mode) =>
				aiModel.build({
					mode,
					inputs: ["text"],
					responseConstraint: TAG_SUGGESTION_SCHEMA,
				}),
		});
		return this.#session;
	}
}
