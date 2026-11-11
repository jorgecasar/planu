import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AiModelPort } from "../application/ports/ai-model.js";
import type { SessionUser } from "../application/ports/session.js";
import { createAiModelSession, type TokenClaims } from "./ai-model-session.js";
import { suggestTagsWithAi, TAG_SUGGESTION_SCHEMA } from "./suggest-tags.js";

/** What the model is shown, read at the moment it's about to be asked. */
export interface TagSuggestionInput {
	title: string;
	description: string;
	location: string;
	knownTags: readonly string[];
	/** The ones already on this event aren't proposed again. */
	chosenTags: readonly string[];
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
