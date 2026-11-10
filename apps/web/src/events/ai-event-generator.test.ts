import { expect, test, vi } from "vitest";
import type {
	AiModelPort,
	AiModelRequest,
} from "../application/ports/ai-model.js";
import type { SessionUser } from "../application/ports/session.js";
import type { ModelAvailability } from "../domain/ai-availability.js";
import type {
	GeneratedDraft,
	PlanuAiEventGenerator,
} from "./ai-event-generator.js";
import { explainFailure } from "./ai-event-generator.js";
import type { ModelLike } from "./ai-model-session.js";
import { GenerationError, RESPONSE_JSON_SCHEMA } from "./generate-event.js";
import { TextInputError } from "./generate-from-text.js";

interface FakeModelResponse {
	response: { text: () => string; inferenceSource: string };
}

const generateContent = vi.fn(
	async (): Promise<FakeModelResponse> => ({
		response: {
			text: () => '{"title":"Test Event","start":"2026-01-15T10:00:00"}',
			inferenceSource: "on_device",
		},
	}),
);

/** A fake `AiModelPort`: no SDK, no emulator. */
const aiModel = {
	build: vi.fn(
		async (_request: AiModelRequest): Promise<ModelLike> => ({
			initializeDeviceModel: async () => {},
			generateContent,
		}),
	),
} satisfies AiModelPort;

// Mock LanguageModel global so checkAvailability returns "available"
(
	globalThis as unknown as {
		LanguageModel?: { availability: () => Promise<ModelAvailability> };
	}
).LanguageModel = {
	availability: async () => "available" as ModelAvailability,
};

// Progress messages live in `domain/ai-progress.ts`, tested there.

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
	// Import the component module to ensure it's registered
	await import("./ai-event-generator.js");

	const el = document.createElement(
		"planu-ai-event-generator",
	) as PlanuAiEventGenerator;

	// Inject the port and dependencies
	setState(el, "imageStore", store);
	setState(el, "user", user);
	setState(el, "aiModel", aiModel);

	// connectedCallback runs and calls #warmUp, which uses the fake port.
	document.body.append(el);
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

// --- Embedded lifecycle: no `open`, a fresh instance mounts each time ------

const DEFAULT_USER: SessionUser = {
	uid: "test-user-123",
	email: "test@example.com",
	displayName: "Test User",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

/** Mounts a fresh, fully wired instance, the same way `event-editor.ts` does. */
async function mountGenerator(
	store: ReturnType<typeof fakeImageStore> = fakeImageStore(),
): Promise<{
	el: PlanuAiEventGenerator;
	store: ReturnType<typeof fakeImageStore>;
}> {
	await import("./ai-event-generator.js");
	const el = document.createElement(
		"planu-ai-event-generator",
	) as PlanuAiEventGenerator;
	setState(el, "imageStore", store);
	setState(el, "user", DEFAULT_USER);
	setState(el, "aiModel", aiModel);
	// connectedCallback runs and calls #warmUp, which uses the fake port.
	document.body.append(el);
	await el.updateComplete;
	return { el, store };
}

function findButton(el: PlanuAiEventGenerator, text: string): HTMLElement {
	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes(text),
	);
	if (!boton) throw new Error(`No se encontró el botón "${text}"`);
	return boton as HTMLElement;
}

function selectFile(el: PlanuAiEventGenerator, file: File): void {
	const input = el.shadowRoot?.querySelector<HTMLInputElement>("#ai-image");
	if (!input) throw new Error("No se encontró el input de imagen");
	const dt = new DataTransfer();
	dt.items.add(file);
	input.files = dt.files;
	const event = new Event("change", { bubbles: true });
	Object.defineProperty(event, "target", { value: input });
	input.dispatchEvent(event);
}

test("generar desde imagen emite el borrador con título, fuente y portada", async () => {
	const { el, store } = await mountGenerator();

	const detail = await new Promise<GeneratedDraft>((resolve) => {
		el.addEventListener(
			"planu-event-generated",
			(domEvent) => resolve((domEvent as CustomEvent<GeneratedDraft>).detail),
			{ once: true },
		);
		selectFile(el, new File(["test"], "cover.png", { type: "image/png" }));
	});

	expect(detail.event.title).toBe("Test Event");
	expect(detail.source).toBe("on_device");
	expect(detail.event.imageUrl).toBe("https://example.com/uploaded-image.png");
	expect(store.calls).toHaveLength(1);

	el.remove();
});

test("generar desde texto emite el borrador sin subir portada", async () => {
	const { el, store } = await mountGenerator();

	setState(el, "text", "Cena de equipo el próximo viernes en la oficina");
	await el.updateComplete;

	const detail = await new Promise<GeneratedDraft>((resolve) => {
		el.addEventListener(
			"planu-event-generated",
			(domEvent) => resolve((domEvent as CustomEvent<GeneratedDraft>).detail),
			{ once: true },
		);
		findButton(el, "Generate from text").click();
	});

	expect(detail.event.title).toBe("Test Event");
	expect(detail.event.imageUrl).toBeUndefined();
	expect(store.calls).toHaveLength(0);

	el.remove();
});

test('"Write it by hand" emite planu-generator-dismiss sin detalle', async () => {
	const { el } = await mountGenerator();

	const domEvent = await new Promise<CustomEvent>((resolve) => {
		el.addEventListener(
			"planu-generator-dismiss",
			(event) => resolve(event as CustomEvent),
			{ once: true },
		);
		findButton(el, "Write it by hand").click();
	});

	expect(domEvent.detail).toBeNull();

	el.remove();
});

test('"Generate from text" y "Write it by hand" llevan type="button"', async () => {
	// Both live inside event-editor.ts's own <form>: without an explicit
	// type="button", clicking either would submit the still near-empty
	// event form instead of doing what it's meant to do.
	const { el } = await mountGenerator();

	expect(findButton(el, "Generate from text").getAttribute("type")).toBe(
		"button",
	);
	expect(findButton(el, "Write it by hand").getAttribute("type")).toBe(
		"button",
	);

	el.remove();
});

test("desconectar durante la generación no emite el borrador ni sube la portada", async () => {
	// Replaces the old `#generation` token test: since a fresh instance
	// mounts every time this is shown, the only cancellation case left is
	// "removed from the DOM while a response is still in flight".
	let resuelveGeneracion: ((value: FakeModelResponse) => void) | undefined;
	generateContent.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resuelveGeneracion = resolve;
			}),
	);

	const { el, store } = await mountGenerator();
	const generated = vi.fn();
	el.addEventListener("planu-event-generated", generated);

	selectFile(el, new File(["test"], "cover.png", { type: "image/png" }));
	// Waits for warm-up and for the generation to reach the pending response.
	await new Promise((resolve) => setTimeout(resolve, 20));

	el.remove();
	resuelveGeneracion?.({
		response: {
			text: () => '{"title":"Too late"}',
			inferenceSource: "on_device",
		},
	});
	await new Promise((resolve) => setTimeout(resolve, 20));

	expect(generated).not.toHaveBeenCalled();
	expect(store.calls).toHaveLength(0);
});

// --- AI model port ----------------------------------------------------------

test("pide al puerto un modelo de texto e imagen, con el esquema y el modo de ai-policy", async () => {
	aiModel.build.mockClear();
	const { el } = await mountGenerator();
	await vi.waitFor(() => expect(aiModel.build).toHaveBeenCalled());

	expect(aiModel.build).toHaveBeenCalledWith({
		// Cloud is closed by default: ai-policy resolves on-device.
		mode: "only_on_device",
		inputs: ["text", "image"],
		responseConstraint: RESPONSE_JSON_SCHEMA,
	});

	el.remove();
});

test("sin puerto de IA no prepara ni genera nada", async () => {
	await import("./ai-event-generator.js");
	const el = document.createElement("planu-ai-event-generator");
	const generated = vi.fn();
	el.addEventListener("planu-event-generated", generated);
	document.body.append(el);
	await el.updateComplete;

	setState(el, "text", "Cena de equipo el viernes");
	await el.updateComplete;
	findButton(el, "Generate from text").click();
	await new Promise((resolve) => setTimeout(resolve, 20));

	// Without the guard it would try and fail, showing an error.
	expect((el as unknown as Record<string, unknown>)["error"]).toBe("");
	expect(generated).not.toHaveBeenCalled();

	el.remove();
});
