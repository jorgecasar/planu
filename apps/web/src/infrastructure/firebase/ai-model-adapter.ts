import type { FirebaseApp } from "firebase/app";
import type { AiModelPort } from "../../application/ports/ai-model.js";

/**
 * `AiModelPort` over Firebase AI Logic in hybrid mode. No `inCloudParams`
 * on purpose: see `createAiModelSession()`.
 */
export function createAiModelAdapter(app: FirebaseApp): AiModelPort {
	return {
		async build({ mode, inputs, responseConstraint }) {
			// Dynamic import: the AI SDK weighs hundreds of kB and most sessions
			// never use it. It must not be part of the startup bundle.
			const { getAI, getGenerativeModel, GoogleAIBackend } = await import(
				"firebase/ai"
			);
			const ai = getAI(app, { backend: new GoogleAIBackend() });
			return getGenerativeModel(ai, {
				mode,
				onDeviceParams: {
					createOptions: {
						expectedInputs: inputs.map((type) => ({ type })),
					},
					promptOptions: { responseConstraint },
				},
			});
		},
	};
}
