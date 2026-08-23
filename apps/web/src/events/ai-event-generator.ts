import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";

import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";

import { consume } from "@lit/context";
import { msg, str } from "@lit/localize";
import type { FirebaseApp } from "firebase/app";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
import type {
	InferenceModeName,
	InferenceSourceName,
} from "../domain/ai-policy.js";
import {
	appContext,
	imageStoreContext,
	userContext,
} from "../firebase/context.js";
import type { PlanuEvent } from "../lib/types.js";
import {
	type AiModelSession,
	createAiModelSession,
	type ModelLike,
	type TokenClaims,
} from "./ai-model-session.js";
import {
	type GenerateContent,
	type GeneratedEvent,
	GenerationError,
	generateEventFromImage,
	RESPONSE_JSON_SCHEMA,
} from "./generate-event.js";
import {
	generateEventFromText,
	MAX_TEXT_LENGTH,
	TextInputError,
} from "./generate-from-text.js";

/** Which of the two inputs the current generation came from. */
export type WorkingOn = "image" | "text";

/**
 * What's happening right now, phrased with the words of the input that
 * triggered it.
 *
 * Lives outside the class so it can be tested: the message once said
 * "Reading the image…" while a pasted text was being read, and no test could
 * catch it because it was embedded in the template.
 */
export function progressMessage(state: {
	preparing: boolean;
	downloading: boolean;
	uploading: boolean;
	on: WorkingOn;
}): string {
	if (state.downloading) {
		return msg("Downloading the AI model, this can take a few minutes…");
	}
	if (state.preparing) return msg("Getting the AI model ready…");
	if (state.uploading) return msg("Saving the image…");
	return state.on === "text"
		? msg("Reading your text and pulling out the event…")
		: msg("Reading the image and pulling out the event…");
}

/**
 * The second line: why the wait is worth it.
 *
 * The model runs on the device, so neither the text nor the photo leave here.
 * Saying so while waiting turns an uncomfortable silence into the reason it
 * takes a while.
 */
export function progressHint(state: {
	downloading: boolean;
	uploading: boolean;
	onDevice: boolean;
}): string {
	if (state.downloading) {
		return msg("It only happens once. You can leave this open.");
	}
	// The cover image **does** leave the device: it's saved to your account.
	// Promising here that nothing leaves would be a lie exactly at the moment
	// it stops being true.
	if (state.uploading) return msg("The image is saved to your account.");
	return state.onDevice
		? msg("It runs on your device: nothing you wrote leaves it.")
		: msg("This can take a few seconds.");
}

/**
 * What to tell the person in front of the screen when something fails.
 *
 * The three cases are different and lead to different actions: what they
 * pasted isn't valid, no event could be extracted, or the AI isn't
 * available. A single message for all three forces them to guess what to
 * do.
 *
 * `modelReady` decides the middle case, and it's not theoretical: measured
 * against Gemini Nano, a text with no event at all —"Remember to buy milk
 * and batteries"— makes the model **throw an error** instead of answering
 * with the empty title it's asked for. Without this, that text would
 * announce an AI failure that isn't real.
 */
export function explainFailure(state: {
	cause: unknown;
	unreadable: string;
	modelReady: boolean;
}): string {
	if (state.cause instanceof TextInputError) {
		return state.cause.reason === "too-long"
			? msg(
					"That text is too long. Leave just the part that describes the event.",
				)
			: msg("Paste the text of the event first.");
	}

	if (state.cause instanceof GenerationError || state.modelReady) {
		return state.unreadable;
	}

	return msg(
		"Event generation is unavailable right now. You can still create the event by hand.",
	);
}

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
 */
@customElement("planu-ai-event-generator")
export class PlanuAiEventGenerator extends LitElement {
	static override styles = css`
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

	@property({ type: Boolean }) open = false;

	@consume({ context: appContext, subscribe: true })
	private app: FirebaseApp | undefined;

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
	 * Changes when the dialog closes. Anything still in flight checks its
	 * token before taking effect: without this, cancelling didn't cancel
	 * anything and a late-arriving generation would upload the image and
	 * reopen the editor anyway.
	 */
	#generation = 0;

	override willUpdate(changed: Map<string, unknown>): void {
		if (changed.has("open") && this.open) {
			this.#revokePreview();
			this.preview = "";
			this.text = "";
			this.progress = 0;
			this.error = "";
			this.downloading = false;
			// Opening the dialog is already clear intent: Chrome recommends
			// preparing the model here rather than on clicking generate, so the
			// download happens while the user picks the photo instead of
			// after.
			void this.#warmUp();
		}
	}

	/** Prepares the model in the background. Errors wait until generation. */
	async #warmUp(): Promise<void> {
		this.availability = await checkAvailability();
		if (!this.app) return;

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
			<wa-dialog
				label=${msg("Generate event with AI")}
				.open=${this.open}
				@wa-hide=${this.#close}
			>
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
					${this.preview ? html`<img src=${this.preview} alt="" />` : nothing}
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

				<wa-button slot="footer" appearance="outlined" @click=${this.#close}>
					${msg("Cancel")}
				</wa-button>
			</wa-dialog>
		`;
	}

	/**
	 * Builds the actual model. It's the only function in this component that
	 * knows the SDK; `ai-model-session.ts` deliberately doesn't import it, so
	 * as not to add a new coupled file to the boundary in
	 * `arch/boundary.test.ts`.
	 */
	async #buildModel(mode: InferenceModeName): Promise<ModelLike> {
		// Dynamic import: the AI SDK weighs hundreds of kB and most sessions
		// never use it. It must not be part of the startup bundle.
		const { getAI, getGenerativeModel, GoogleAIBackend } = await import(
			"firebase/ai"
		);

		// biome-ignore lint/style/noNonNullAssertion: only called with app set
		const ai = getAI(this.app!, { backend: new GoogleAIBackend() });
		return getGenerativeModel(ai, {
			mode,
			onDeviceParams: {
				createOptions: {
					expectedInputs: [{ type: "text" }, { type: "image" }],
				},
				promptOptions: { responseConstraint: RESPONSE_JSON_SCHEMA },
			},
		});
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
			buildModel: (mode) => this.#buildModel(mode),
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
		if (!file || !this.app) return;

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
		if (!this.app) return;

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
	 * No failure here leaves the user without a way out: they stay in the
	 * dialog with the reason written out and manual entry still intact
	 * behind it.
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
		const token = this.#generation;
		this.error = "";
		this.workingOn = on;
		this.busy = true;

		try {
			// The model has already been preparing since the dialog opened; this
			// just waits for it to finish if it hasn't already.
			await this.#warmUp();
			const session = this.#session();

			let source: InferenceSourceName | undefined;
			const generated = await extract(async (parts) => {
				const response = await session.generate(parts);
				source = response.source;
				return response.text;
			});

			// If the user cancelled while the model was thinking, it stops here:
			// the image doesn't get uploaded and the editor doesn't reopen
			// behind their back.
			if (token !== this.#generation) return;

			// The cover is uploaded after generating, not before, so as not to
			// leave the images of attempts that don't lead anywhere in
			// Storage.
			const imageUrl = cover ? await this.#uploadCover(cover) : "";

			// Again, because uploading the cover takes a while: without this,
			// cancelling during the upload would let it finish and reopen the
			// editor behind their back.
			if (token !== this.#generation) return;

			this.#emit({
				event: imageUrl ? { ...generated, imageUrl } : generated,
				source,
			});
			this.analytics.trackAiUsed({ fromImage: on === "image" });
			this.#close();
		} catch (cause) {
			if (token !== this.#generation) return;
			this.error = explainFailure({
				cause,
				unreadable,
				modelReady: this.availability === "available",
			});
		} finally {
			// Only whoever turned the lights on turns them off. Without this
			// guard, a cancelled generation that resolved late would turn off
			// the notice of the one currently in progress and re-enable its
			// fields mid-flight.
			if (token === this.#generation) {
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

	#close(): void {
		this.#generation++;
		this.#revokePreview();
		// And it forgets what was there: cancelling during a slow generation
		// left `busy` on, so reopening the dialog came up with the field, the
		// selector and the button disabled and a notice from the previous
		// time. The only way out was waiting for a call that might never come
		// back.
		this.preview = "";
		this.busy = false;
		this.preparing = false;
		this.uploading = false;
		this.downloading = false;
		this.open = false;
		this.dispatchEvent(new CustomEvent("planu-generator-close"));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-ai-event-generator": PlanuAiEventGenerator;
	}
}
