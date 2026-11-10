import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";

import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	type AiModelPort,
	aiModelContext,
} from "../application/ports/ai-model.js";
import {
	type AnalyticsPort,
	analyticsContext,
	noopAnalytics,
} from "../application/ports/analytics.js";
import type { ImageStorePort } from "../application/ports/image-store.js";
import type { SessionUser } from "../application/ports/session.js";
import {
	checkAvailability,
	type ModelAvailability,
	needsDownload,
} from "../domain/ai-availability.js";
import type { InferenceSourceName } from "../domain/ai-policy.js";
import {
	progressHint,
	progressMessage,
	type WorkingOn,
} from "../domain/ai-progress.js";
import { imageStoreContext, userContext } from "../firebase/context.js";
import type { PlanuEvent } from "../lib/types.js";
import { explainFailure } from "./ai-failure.js";
import {
	type AiModelSession,
	createAiModelSession,
	type TokenClaims,
} from "./ai-model-session.js";
import {
	type GenerateContent,
	type GeneratedEvent,
	generateEventFromImage,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";
import {
	generateEventFromText,
	MAX_TEXT_LENGTH,
} from "./generate-from-text.js";

/** What the generator hands off to the editor. */
export interface GeneratedDraft {
	event: Partial<PlanuEvent>;
	/** Where it was resolved: useful for the user and for watching the spend. */
	source: InferenceSourceName | undefined;
}

/**
 * Generates an event from the photo of a poster or from pasted text.
 *
 * Uses Firebase AI Logic in hybrid mode: if the browser ships built-in AI it
 * runs on the device —free, no network, and the image never leaves here—;
 * otherwise it falls back to Gemini in the cloud. Whatever it returns always
 * goes through the editor for the user to review: Gemini Nano often gets
 * dates wrong.
 *
 * The two inputs share the model, the response schema and the cloud policy:
 * the only things that change are the prompt and, for the image, that the
 * poster gets uploaded as the cover. That's why the common path lives in
 * `#generate()` and each input only contributes how to extract and what to
 * say if the model can't make sense of anything.
 *
 * Embedded, not its own dialog: `event-editor.ts` mounts this as the first
 * child of its own form when it's worth offering, and unmounts it the same
 * way — the same pattern T33's sample event and any other conditional
 * section of that form already use, documented on `#renderForm` there. A
 * fresh instance is created every time it's shown, so nothing here needs to
 * reset itself on reopening.
 */
@customElement("planu-ai-event-generator")
export class PlanuAiEventGenerator extends LitElement {
	static override styles = css`
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

	@consume({ context: aiModelContext, subscribe: true })
	private aiModel: AiModelPort | undefined;

	@consume({ context: imageStoreContext, subscribe: true })
	private imageStore: ImageStorePort | undefined;

	@consume({ context: userContext, subscribe: true })
	private user: SessionUser | null | undefined;

	@consume({ context: analyticsContext, subscribe: true })
	private analytics: AnalyticsPort = noopAnalytics;

	@state() private preview = "";
	@state() private text = "";
	@state() private workingOn: WorkingOn = "image";
	@state() private busy = false;
	@state() private preparing = false;
	@state() private uploading = false;
	@state() private downloading = false;

	/**
	 * Whether this session resolves without leaving the device. Today always
	 * true, because of the lock in `ai-policy.ts`; it's queried instead of
	 * assumed so the notice doesn't lie the day the cloud path opens up.
	 *
	 * Starts as `false` for the same reason: the progress block already paints
	 * during preparation, before the policy has resolved, and promising
	 * privacy in that window would be asserting something that isn't known
	 * yet.
	 */
	@state() private onDevice = false;
	@state() private progress = 0;
	@state() private error = "";

	@state() private availability: ModelAvailability | undefined;

	/**
	 * One per component instance: rebuilding it on every open would repeat the
	 * model download.
	 */
	#modelSession: AiModelSession | undefined;

	/**
	 * Set when this element is disconnected. Anything still in flight checks
	 * it before taking effect: without this, removing this element from the
	 * DOM didn't cancel anything, and a late-arriving generation would upload
	 * the image and reach a parent that's no longer listening. A single
	 * boolean is enough — unlike the tag-suggestion session in
	 * `event-editor.ts`, this element is never reused across generations: a
	 * fresh instance mounts every time it's shown, so there's no "still
	 * connected but for a different generation" case to tell apart.
	 */
	#disposed = false;

	override connectedCallback(): void {
		super.connectedCallback();
		// Mounting is already clear intent: Chrome recommends preparing the
		// model here rather than on clicking generate, so the download
		// happens while the user picks the photo instead of after.
		void this.#warmUp();
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#disposed = true;
		this.#revokePreview();
	}

	/** Prepares the model in the background. Errors wait until generation. */
	async #warmUp(): Promise<void> {
		this.availability = await checkAvailability();
		if (!this.aiModel) return;

		this.preparing = true;
		try {
			await this.#session().warmUp((percent) => {
				this.downloading = true;
				this.progress = percent;
			});
			this.downloading = false;
		} catch {
			// Deliberately silent: the user hasn't asked for anything yet. If it
			// genuinely fails, they'll find out when they try to generate, with
			// its own message. The session already heals itself: the next
			// attempt rebuilds it.
		} finally {
			this.preparing = false;
		}
	}

	override render() {
		return html`
			<fieldset>
				<legend>${msg("Fill in with AI")}</legend>
				<p>
					${msg(
						"Upload a poster or flyer, or paste the text of an invitation, and the details will be filled in for you. You can review everything before saving.",
					)}
				</p>

				${
					this.error
						? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>`
						: nothing
				}

				${
					// Warn beforehand, not after: the download can take minutes and
					// an unexplained wait looks like it has frozen.
					needsDownload(this.availability)
						? html`<wa-callout variant="neutral">
								${msg("The first time, your browser downloads the AI model. It can take a few minutes and only happens once.")}
							</wa-callout>`
						: nothing
				}

				<div class="drop">
					<label for="ai-image">${msg("Event image")}</label>
					${this.preview ? html`<img src=${this.preview} alt=${msg("Cover image preview")} />` : nothing}
					<input
						id="ai-image"
						type="file"
						accept="image/png, image/jpeg"
						?disabled=${this.busy}
						@change=${this.#onFile}
					/>
				</div>

				<wa-divider></wa-divider>

				<div class="paste">
					<!-- No \`maxlength\`, and it's not an oversight: the native
					     attribute **trims the paste** without saying anything, which
					     is exactly the silent truncation this limit exists to
					     prevent. Whoever pastes too much sees it written out and
					     decides what to remove. -->
					<wa-textarea
						label=${msg("Or paste the text of the event")}
						hint=${
							this.#tooLong
								? msg(
										"That text is too long. Leave just the part that describes the event.",
									)
								: msg(
										"An email, a message or an announcement. Nothing is saved until you review it.",
									)
						}
						rows="4"
						.withCount=${true}
						?disabled=${this.busy}
						.value=${this.text}
						@input=${this.#onText}
					></wa-textarea>
					<p class="count" ?data-over=${this.#tooLong}>
						${
							// Web Awesome's native counter counts down from
							// `maxlength`, which is no longer there; this one says
							// the same thing and can also go past the limit.
							msg(str`${this.text.trim().length} / ${MAX_TEXT_LENGTH}`)
						}
					</p>
					<wa-button
						type="button"
						variant="brand"
						?disabled=${this.busy || this.text.trim() === "" || this.#tooLong}
						@click=${this.#onGenerateText}
					>
						${msg("Generate from text")}
					</wa-button>
				</div>

				<!-- A single place for the status, and the text is decided by the
				     input that triggered it. It used to live inside the image
				     block, so generating from text would announce that a photo
				     was being read. -->
				${
					this.busy || this.downloading || this.preparing
						? html`<div class="working">
								<wa-spinner></wa-spinner>
								<div>
									<p class="what">
										${progressMessage({
											preparing: this.preparing,
											downloading: this.downloading,
											uploading: this.uploading,
											on: this.workingOn,
										})}
									</p>
									<p class="why">
										${progressHint({
											downloading: this.downloading,
											uploading: this.uploading,
											onDevice: this.onDevice,
										})}
									</p>
								</div>
							</div>`
						: nothing
				}
				${
					this.uploading || this.downloading
						? html`<wa-progress-bar value=${this.progress}></wa-progress-bar>`
						: nothing
				}

				<wa-button type="button" appearance="outlined" @click=${this.#dismiss}>
					${msg("Write it by hand")}
				</wa-button>
			</fieldset>
		`;
	}

	/**
	 * `SessionUser.getIdTokenResult` is optional — not every adapter can
	 * resolve it — and `TokenClaims` requires it. With no user or no such
	 * method, there's no claim to read: cloud AI treats that the same as
	 * "not premium", which is the safe default.
	 */
	#claims(): TokenClaims | null {
		const getIdTokenResult = this.user?.getIdTokenResult;
		return getIdTokenResult ? { getIdTokenResult } : null;
	}

	/**
	 * Creates the session with the model, on-device only. Lazy: building it
	 * doesn't download anything by itself, `warmUp()`/`generate()` do.
	 */
	#session(): AiModelSession {
		this.#modelSession ??= createAiModelSession({
			getUser: () => this.#claims(),
			// Only reached with the port set: every entry point checks it first.
			buildModel: async (mode) => {
				const { aiModel } = this;
				if (!aiModel) throw new Error("AiModelPort not provided");
				return aiModel.build({
					mode,
					inputs: ["text", "image"],
					responseConstraint: RESPONSE_JSON_SCHEMA,
				});
			},
			// What's promised to the user while they wait comes from here, not
			// from an assumption written into the template.
			onInferenceMode: (mode) => {
				this.onDevice = mode === "only_on_device";
			},
		});
		return this.#modelSession;
	}

	#revokePreview(): void {
		if (this.preview.startsWith("blob:")) URL.revokeObjectURL(this.preview);
	}

	async #onFile(domEvent: globalThis.Event): Promise<void> {
		const input = domEvent.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !this.aiModel) return;

		this.#revokePreview();
		this.preview = URL.createObjectURL(file);

		try {
			await this.#generate({
				on: "image",
				extract: (generate) => generateEventFromImage(generate, file),
				// The poster the event was extracted from is its natural cover.
				cover: file,
				unreadable: msg(
					"The image could not be read as an event. Try a clearer photo.",
				),
			});
		} finally {
			// Without this, picking the same photo twice doesn't trigger
			// `change`, and the second attempt would look like it does
			// nothing.
			input.value = "";
		}
	}

	/** Whether the pasted text exceeds the limit. `generate-from-text.ts` checks it again. */
	get #tooLong(): boolean {
		return this.text.trim().length > MAX_TEXT_LENGTH;
	}

	#onText(domEvent: globalThis.Event): void {
		const source = domEvent.composedPath()[0] as HTMLInputElement | undefined;
		this.text = source?.value ?? "";
	}

	async #onGenerateText(): Promise<void> {
		if (!this.aiModel) return;

		await this.#generate({
			on: "text",
			extract: (generate) => generateEventFromText(generate, this.text),
			unreadable: msg(
				"No event could be found in that text. Add the date and the place, or create the event by hand.",
			),
		});
	}

	/**
	 * The common path for both inputs: prepares the model, extracts, and hands
	 * the draft off to the editor.
	 *
	 * No failure here leaves the user without a way out: they stay with the
	 * reason written out and manual entry still intact behind it.
	 */
	async #generate({
		on,
		extract,
		cover,
		unreadable,
	}: {
		on: WorkingOn;
		extract: (generate: GenerateContent) => Promise<GeneratedEvent>;
		cover?: File;
		unreadable: string;
	}): Promise<void> {
		this.error = "";
		this.workingOn = on;
		this.busy = true;

		try {
			// The model has already been preparing since this element mounted;
			// this just waits for it to finish if it hasn't already.
			await this.#warmUp();
			const session = this.#session();

			let source: InferenceSourceName | undefined;
			const generated = await extract(async (parts) => {
				const response = await session.generate(parts);
				source = response.source;
				return response.text;
			});

			// If this element was removed while the model was thinking, stop
			// here: the image doesn't get uploaded and nothing reaches a parent
			// that's no longer listening.
			if (this.#disposed) return;

			// The cover is uploaded after generating, not before, so as not to
			// leave the images of attempts that don't lead anywhere in
			// Storage.
			const imageUrl = cover ? await this.#uploadCover(cover) : "";

			// Again, because uploading the cover takes a while: without this,
			// disconnecting during the upload would let it finish and reach a
			// parent that's no longer listening.
			if (this.#disposed) return;

			this.#emit({
				event: imageUrl ? { ...generated, imageUrl } : generated,
				source,
			});
			this.analytics.trackAiUsed({ fromImage: on === "image" });
		} catch (cause) {
			if (this.#disposed) return;
			this.error = explainFailure({
				cause,
				unreadable,
				modelReady: this.availability === "available",
			});
		} finally {
			// Only whoever turned the lights on turns them off. Without this
			// guard, a generation that resolved after this element was already
			// removed would touch state nobody will ever read again.
			if (!this.#disposed) {
				this.busy = false;
				this.preparing = false;
				this.downloading = false;
			}
		}
	}

	/**
	 * Uploads the poster as the cover. Returns an empty string if it can't.
	 *
	 * A failure here doesn't invalidate what the AI just extracted: losing
	 * the event data is worse than being left without an image, so the
	 * editor opens anyway and the user can add it by hand.
	 */
	async #uploadCover(file: File): Promise<string> {
		const { imageStore, user } = this;
		if (!imageStore || !user) return "";

		this.uploading = true;
		this.progress = 0;
		try {
			return await imageStore.upload(file, `events/${user.uid}`, (percent) => {
				this.progress = percent;
			});
		} catch {
			return "";
		} finally {
			this.uploading = false;
		}
	}

	#emit(draft: GeneratedDraft): void {
		this.dispatchEvent(
			new CustomEvent<GeneratedDraft>("planu-event-generated", {
				detail: draft,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** "Write it by hand": the block goes away without generating anything. */
	#dismiss(): void {
		this.dispatchEvent(
			new CustomEvent("planu-generator-dismiss", {
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-ai-event-generator": PlanuAiEventGenerator;
	}
}
