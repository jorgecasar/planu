import type { FirebaseApp } from "firebase/app";
import { expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import type { ModelAvailability } from "../domain/ai-availability.js";
import type { PlanuAiEventGenerator } from "./ai-event-generator.js";
import {
	explainFailure,
	progressHint,
	progressMessage,
} from "./ai-event-generator.js";
import { GenerationError } from "./generate-event.js";
import { TextInputError } from "./generate-from-text.js";

// Mock the Firebase AI SDK at the module level
interface FakeModelResponse {
	response: { text: () => string; inferenceSource: string };
}

const { generateContent, warmUp } = vi.hoisted(() => ({
	generateContent: vi.fn(
		async (): Promise<FakeModelResponse> => ({
			response: {
				text: () => '{"title":"Test Event","start":"2026-01-15T10:00:00"}',
				inferenceSource: "on_device",
			},
		}),
	),
	warmUp: vi.fn(async (): Promise<void> => {}),
}));

vi.mock("firebase/ai", () => ({
	getAI: vi.fn(() => ({})),
	getGenerativeModel: vi.fn(() => ({ generateContent, warmUp })),
	GoogleAIBackend: vi.fn(),
}));

// Mock LanguageModel global so checkAvailability returns "available"
(
	globalThis as unknown as {
		LanguageModel?: { availability: () => Promise<ModelAvailability> };
	}
).LanguageModel = {
	availability: async () => "available" as ModelAvailability,
};

const state = (over: Partial<Parameters<typeof progressMessage>[0]> = {}) => ({
	preparing: false,
	downloading: false,
	uploading: false,
	on: "image" as const,
	...over,
});

test("leyendo un texto no dice que esté leyendo una imagen", () => {
	// The actual bug: the notice lived inside the image block and announced
	// a photo while it was reading what the user had just pasted.
	const message = progressMessage(state({ on: "text" }));

	expect(message).not.toMatch(/image/i);
	expect(message).toMatch(/text/i);
});

test("leyendo una imagen lo dice", () => {
	expect(progressMessage(state({ on: "image" }))).toMatch(/image/i);
});

test("las fases se anuncian en el orden en que ocurren", () => {
	// Preparing, downloading, reading and saving are four different waits,
	// and a single "loading…" for all four gives no way to tell if something's
	// wrong.
	expect(progressMessage(state({ preparing: true }))).toMatch(/ready/i);
	expect(progressMessage(state({ uploading: true }))).toMatch(/saving/i);
	expect(progressMessage(state({ on: "text" }))).toMatch(/pulling out/i);
});

test("la descarga del modelo manda sobre lo demás", () => {
	// It can take minutes: staying silent about it and saying "reading"
	// would make it look like it has frozen.
	expect(progressMessage(state({ downloading: true, on: "text" }))).toMatch(
		/download/i,
	);
	expect(
		progressMessage(state({ downloading: true, preparing: true })),
	).toMatch(/download/i);
	expect(
		progressMessage(state({ downloading: true, uploading: true })),
	).toMatch(/download/i);
});

const hint = (over: Partial<Parameters<typeof progressHint>[0]> = {}) =>
	progressHint({
		downloading: false,
		uploading: false,
		onDevice: true,
		...over,
	});

test("la segunda línea explica por qué merece la pena esperar", () => {
	expect(hint()).toMatch(/your device/i);
	expect(hint({ downloading: true })).toMatch(/once/i);
});

test("no promete privacidad si la generación puede irse a la nube", () => {
	// Today the lock in ai-policy keeps everything on the device, but the
	// notice is derived from the actual mode: the day the cloud opens up, it
	// would stop lying on its own.
	expect(hint({ onDevice: false })).not.toMatch(/your device/i);
	expect(hint({ onDevice: false })).toMatch(/seconds/i);
});

test("no promete privacidad mientras sube la portada, que sí sale de aquí", () => {
	// Seen in a screenshot: the notice said "nothing you wrote leaves your
	// device" right while the image was traveling to Storage.
	const subiendo = hint({ uploading: true });

	expect(subiendo).not.toMatch(/nothing/i);
	expect(subiendo).toMatch(/account/i);
});

// --- What gets said when something fails ----------------------------------

const fallo = (over: Partial<Parameters<typeof explainFailure>[0]> = {}) =>
	explainFailure({
		cause: new Error("boom"),
		unreadable: "No event could be found in that text.",
		modelReady: true,
		...over,
	});

test("con el modelo listo, la culpa es del texto y no de la IA", () => {
	// Measured against Gemini Nano: "Remember to buy milk and batteries" makes
	// the model throw an error instead of returning the empty title it's
	// asked for. Without this, that text would announce a failure that
	// doesn't exist.
	expect(fallo()).toMatch(/No event could be found/);
});

test("sin modelo, se dice que la IA no está y que se puede seguir a mano", () => {
	const mensaje = fallo({ modelReady: false });

	expect(mensaje).toMatch(/unavailable/i);
	expect(mensaje).toMatch(/by hand/i);
});

test("un texto ilegible por el modelo se explica igual haya IA o no", () => {
	const causa = new GenerationError("nope");

	expect(fallo({ cause: causa })).toMatch(/No event could be found/);
	expect(fallo({ cause: causa, modelReady: false })).toMatch(
		/No event could be found/,
	);
});

test("lo que falla en la entrada se dice antes de culpar a nadie más", () => {
	expect(fallo({ cause: new TextInputError("too-long") })).toMatch(/too long/i);
	expect(fallo({ cause: new TextInputError("empty") })).toMatch(/Paste/i);
	// And it doesn't depend on whether there's a model: the text is just as
	// long without AI.
	expect(
		fallo({ cause: new TextInputError("too-long"), modelReady: false }),
	).toMatch(/too long/i);
});

// --- Image store port integration ------------------------------------------

/**
 * A fake `ImageStorePort` that records what it receives and resolves
 * with a predictable URL.
 */
function fakeImageStore() {
	const calls: {
		file: File;
		prefix: string;
		onProgress: ((percent: number) => void) | undefined;
	}[] = [];
	return {
		calls,
		upload: async (
			file: File,
			prefix: string,
			onProgress?: (percent: number) => void,
		): Promise<string> => {
			calls.push({ file, prefix, onProgress });
			if (onProgress) {
				onProgress(50);
				onProgress(100);
			}
			return "https://example.com/uploaded-image.png";
		},
	};
}

/**
 * Sets a private state on the element by key.
 */
function setState(
	el: PlanuAiEventGenerator,
	key: string,
	value: unknown,
): void {
	(el as unknown as Record<string, unknown>)[key] = value;
}

test("usa el puerto ImageStorePort para subir la portada, no firebase/storage directamente", async () => {
	// This test verifies that ai-event-generator.ts consumes the imageStoreContext
	// (ImageStorePort) instead of importing firebase/storage directly.
	const store = fakeImageStore();
	const user: SessionUser = {
		uid: "test-user-123",
		email: "test@example.com",
		displayName: "Test User",
		photoURL: null,
		emailVerified: true,
		provider: "password",
	};
	const app = {} as FirebaseApp;

	// Import the component module to ensure it's registered
	await import("./ai-event-generator.js");

	const el = document.createElement(
		"planu-ai-event-generator",
	) as PlanuAiEventGenerator;

	// Inject the port and dependencies
	setState(el, "imageStore", store);
	setState(el, "user", user);
	setState(el, "app", app);

	document.body.append(el);
	await el.updateComplete;

	// Open the dialog - willUpdate runs and calls #warmUp which uses our mocked firebase/ai
	el.open = true;
	await el.updateComplete;

	const file = new File(["test"], "cover.png", { type: "image/png" });

	// Trigger file selection through the public API
	const input = el.shadowRoot?.querySelector<HTMLInputElement>("#ai-image");
	if (input) {
		// Create a DataTransfer with our test file
		const dt = new DataTransfer();
		dt.items.add(file);
		input.files = dt.files;

		// Dispatch change event
		const event = new Event("change", { bubbles: true });
		Object.defineProperty(event, "target", { value: input });
		await input.dispatchEvent(event);
		await el.updateComplete;

		// Wait a bit for the async operations to complete
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// Debug: check store calls after uploadCover
	console.log("Store calls after uploadCover:", store.calls);
	console.log("busy:", el["busy"]);
	console.log("error:", el["error"]);
	console.log("uploading:", el["uploading"]);

	// The component should use the injected imageStore port
	expect(store.calls).toHaveLength(1);
	expect(store.calls[0]?.prefix).toBe("events/test-user-123");

	el.remove();
});
