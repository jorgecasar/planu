/**
 * The part of AI generation that has nothing to do with Lit or Firebase:
 * session availability, model caching, self-healing after a failure,
 * download and resolving the inference mode.
 *
 * It used to live duplicated inside `ai-event-generator.ts` only because it
 * was the sole component that needed it. T24 needs the same thing in
 * `event-editor.ts` to suggest tags, and duplicating it there would have
 * been exactly the debt a T23 review flagged as pending.
 *
 * **It does not import `firebase/*` anywhere, on purpose.** Extracting this
 * into a file that did import the SDK would have added a new coupled file —
 * `arch/boundary.test.ts` fixes the cap at 23 and it can only go down — so
 * instead of bringing `getAI`/`getGenerativeModel` in here, an already-built
 * `buildModel` is received: whoever calls it is the one who already has the
 * legitimate coupling — a component with `@consume` on Firebase contexts —
 * and only orchestration lives here, which is exactly what is
 * provider-agnostic.
 *
 * This is also what opens the seam that was missing: without it, none of
 * this could be tested without talking to Firebase for real, and
 * cancellation and self-healing after a failure were left with no test at
 * all in T23 for that exact reason.
 */

import type { EventPart, ModelLike } from "../application/ports/ai-model.js";
import {
	type InferenceModeName,
	type InferenceSourceName,
	resolveInferenceMode,
} from "../domain/ai-policy.js";

/**
 * The minimum a user session needs: the premium claim. Duck typing instead
 * of `User` from `firebase/auth`, so as not to import it here.
 */
export interface TokenClaims {
	getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
}

export type { ModelLike };

export interface GeneratedResponse {
	text: string;
	/** The SDK says where it ended up running; the mode is only a preference. */
	source: InferenceSourceName | undefined;
}

export interface AiModelSessionOptions {
	/**
	 * A function, not a value: the premium claim is re-read on every model
	 * build, so the current session at that instant is needed, not the one
	 * that existed when this session was created.
	 */
	getUser: () => TokenClaims | null | undefined;
	/**
	 * Builds the model with the mode already resolved. The caller knows the
	 * SDK; this does not need to know it in order to cache, cancel and
	 * self-heal.
	 */
	buildModel: (mode: InferenceModeName) => Promise<ModelLike>;
	/** Told the resolved mode; useful for not over-promising privacy. */
	onInferenceMode?: (mode: InferenceModeName) => void;
}

export interface AiModelSession {
	/** Prepares the on-device model. Memoised: calling twice does not repeat the download. */
	warmUp(onProgress: (percent: number) => void): Promise<void>;
	/** Generates from the message parts. */
	generate(parts: EventPart[]): Promise<GeneratedResponse>;
}

/**
 * Builds a model session.
 *
 * `only_on_device` waits for the download to finish instead of resolving
 * some other way, and on a problem it throws the real cause instead of
 * staying silent. There is no `inCloudParams` on purpose: reopening the
 * cloud requires adding them back and configuring App Check in whoever
 * builds the model, not changing an environment variable.
 */
export function createAiModelSession(
	options: AiModelSessionOptions,
): AiModelSession {
	/**
	 * A single instance per session: warm-up and generation share it. A
	 * rejection is **not** left memoised — if it were kept, a transient
	 * failure while building the model would leave the AI dead for the rest
	 * of the session.
	 */
	let modelPromise: Promise<ModelLike> | undefined;

	/** Same as `modelPromise`: memoised, but not on failure. */
	let warmupPromise: Promise<void> | undefined;

	async function inferenceMode(): Promise<InferenceModeName> {
		const cloudEnabled = import.meta.env.VITE_AI_CLOUD_FALLBACK === "true";

		let premium = false;
		const user = options.getUser();
		if (cloudEnabled && user) {
			try {
				const token = await user.getIdTokenResult();
				premium = token.claims["premium"] === true;
			} catch {
				premium = false;
			}
		}

		const mode = resolveInferenceMode({ cloudEnabled, premium });
		options.onInferenceMode?.(mode);
		return mode;
	}

	function model(): Promise<ModelLike> {
		modelPromise ??= inferenceMode()
			.then((mode) => options.buildModel(mode))
			.catch((cause: unknown) => {
				modelPromise = undefined;
				throw cause;
			});
		return modelPromise;
	}

	return {
		async warmUp(onProgress) {
			warmupPromise ??= (async () => {
				const built = await model();
				await built.initializeDeviceModel((progress) => {
					onProgress(progress * 100);
				});
			})().catch((cause: unknown) => {
				warmupPromise = undefined;
				throw cause;
			});
			return warmupPromise;
		},

		async generate(parts) {
			const built = await model();
			const result = await built.generateContent({
				contents: [{ role: "user", parts }],
			});
			return {
				text: result.response.text(),
				source: result.response.inferenceSource as
					| InferenceSourceName
					| undefined,
			};
		},
	};
}
