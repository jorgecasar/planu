import { createContext } from "@lit/context";
import type { InferenceModeName } from "../../domain/ai-policy.js";

export type EventPart =
	| { text: string }
	| { inlineData: { mimeType: string; data: string } };

/** The minimum a generative model needs, without the SDK's real type. */
export interface ModelLike {
	initializeDeviceModel(onProgress: (progress: number) => void): Promise<void>;
	// The real SDK restricts `role` to a union of literals; here only "user"
	// is needed, which is the only one ever sent.
	generateContent(input: {
		contents: Array<{ role: "user"; parts: EventPart[] }>;
	}): Promise<{ response: { text(): string; inferenceSource?: string } }>;
}

/**
 * Builds a generative model without exposing Firebase AI Logic. The mode
 * arrives already resolved by `domain/ai-policy.ts`: the adapter applies
 * it, never decides it.
 */
export interface AiModelRequest {
	mode: InferenceModeName;
	/** What the on-device model must accept. */
	inputs: Array<"text" | "image">;
	/** JSON schema the on-device answer must follow. */
	responseConstraint: object;
}

export interface AiModelPort {
	build(request: AiModelRequest): Promise<ModelLike>;
}

export const aiModelContext = createContext<AiModelPort | undefined>(
	Symbol("planu-ai-model"),
);
