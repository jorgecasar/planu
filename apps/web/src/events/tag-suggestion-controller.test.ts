import type { ReactiveControllerHost } from "lit";
import { expect, test, vi } from "vitest";
import type { AiModelPort, ModelLike } from "../application/ports/ai-model.js";
import {
	TagSuggestionController,
	type TagSuggestionInput,
} from "./tag-suggestion-controller.js";

/** A host with no element behind it: only the calls the controller makes. */
function fakeHost() {
	return {
		addController: vi.fn(),
		removeController: vi.fn(),
		requestUpdate: vi.fn(),
		updateComplete: Promise.resolve(true),
	} satisfies ReactiveControllerHost;
}

/**
 * A model whose download is held open until the test releases it, so the
 * test decides what happens while it's in flight.
 */
function heldModel(tags: string[] = ["cena", "verano"], holdAnswer = false) {
	let reportProgress: (fraction: number) => void = () => {};
	let finishDownload: (failure?: Error) => void = () => {};
	let downloadStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		downloadStarted = resolve;
	});
	let generationStarted: () => void = () => {};
	const generating = new Promise<void>((resolve) => {
		generationStarted = resolve;
	});
	const answer = { response: { text: () => JSON.stringify({ tags }) } };
	let releaseAnswer: () => void = () => {};
	const generateContent = vi.fn(() => {
		generationStarted();
		return holdAnswer
			? new Promise<typeof answer>((resolve) => {
					releaseAnswer = () => resolve(answer);
				})
			: Promise.resolve(answer);
	});
	const model: ModelLike = {
		initializeDeviceModel: (onProgress) =>
			new Promise<void>((resolve, reject) => {
				reportProgress = onProgress;
				finishDownload = (failure) => (failure ? reject(failure) : resolve());
				downloadStarted();
			}),
		generateContent,
	};
	const aiModel: AiModelPort = { build: async () => model };
	return {
		aiModel,
		generateContent,
		/** Resolves once the session has built the model and is downloading. */
		started,
		/** Resolves once the model has been asked; with `holdAnswer`, it waits. */
		generating,
		answer: () => releaseAnswer(),
		progress: (fraction: number) => reportProgress(fraction),
		finish: (failure?: Error) => finishDownload(failure),
	};
}

const input = (): TagSuggestionInput => ({
	title: "Cena",
	description: "",
	location: "",
	knownTags: [],
	chosenTags: [],
});

function setup(model = heldModel()) {
	const host = fakeHost();
	const controller = new TagSuggestionController(host, {
		getAiModel: () => model.aiModel,
		getUser: () => null,
	});
	return { host, controller, model };
}

test("se registra en su host al crearse", () => {
	const { host, controller } = setup();
	expect(host.addController).toHaveBeenCalledWith(controller);
});

test("invalidar durante la descarga ignora su progreso y lo que venga después", async () => {
	const { controller, model } = setup();
	const done = controller.suggest(input);
	await model.started;
	expect(controller.suggesting).toBe(true);

	controller.invalidate();
	model.progress(0.5);
	expect(controller.downloading).toBe(false);
	expect(controller.progress).toBe(0);

	model.finish();
	await done;
	expect(model.generateContent).not.toHaveBeenCalled();
	expect(controller.suggested).toEqual([]);
	// The stale request doesn't touch the flag either: `reset()` owns it.
	expect(controller.suggesting).toBe(true);
});

test("reset() lo limpia todo y deja sin efecto la petición en vuelo", async () => {
	const { controller, model } = setup();
	controller.suggested = ["viejo"];
	const done = controller.suggest(input);
	await model.started;
	model.progress(0.5);
	expect(controller.downloading).toBe(true);
	expect(controller.progress).toBe(50);

	controller.reset();
	expect(controller.suggested).toEqual([]);
	expect(controller.suggesting).toBe(false);
	expect(controller.downloading).toBe(false);
	expect(controller.progress).toBe(0);

	model.finish();
	await done;
	expect(controller.suggested).toEqual([]);
	expect(controller.suggesting).toBe(false);
});

test("si la descarga falla, calla y deja el botón libre", async () => {
	const { host, controller, model } = setup();
	const done = controller.suggest(input);
	await model.started;
	model.progress(0.2);
	const before = host.requestUpdate.mock.calls.length;
	model.finish(new Error("descarga interrumpida"));

	await expect(done).resolves.toBeUndefined();
	// Without this repaint the button would stay painted as disabled.
	expect(host.requestUpdate.mock.calls.length).toBeGreaterThan(before);
	expect(controller.suggesting).toBe(false);
	expect(controller.downloading).toBe(false);
	expect(controller.suggested).toEqual([]);
});

test("aceptar una sugerencia quita sólo esa", () => {
	const { controller } = setup();
	controller.suggested = ["cena", "verano", "amigos"];
	controller.accept("verano");
	expect(controller.suggested).toEqual(["cena", "amigos"]);
});

test("lee el formulario después de la descarga, no al pulsar", async () => {
	const { controller, model } = setup();
	const read = vi.fn(input);
	const done = controller.suggest(read);
	await model.started;
	expect(read).not.toHaveBeenCalled();

	model.finish();
	await done;
	expect(read).toHaveBeenCalledTimes(1);
	expect(controller.suggested).toEqual(["cena", "verano"]);
	expect(controller.suggesting).toBe(false);
});

test("cada cambio de estado pide al host que vuelva a pintar", async () => {
	const { host, controller, model } = setup(heldModel(["cena"], true));
	const repaints = () => host.requestUpdate.mock.calls.length;
	let before = repaints();
	const changed = () => {
		expect(repaints()).toBeGreaterThan(before);
		before = repaints();
	};

	const done = controller.suggest(input);
	changed(); // suggesting
	await model.started;
	model.progress(0.3);
	changed(); // downloading and progress
	model.finish();
	await model.generating;
	changed(); // download over, with the model still thinking
	expect(controller.downloading).toBe(false);
	expect(controller.suggesting).toBe(true);
	model.answer();
	await done;
	changed(); // suggestions, suggesting off

	controller.accept("cena");
	changed();
	controller.suggested = ["x"];
	changed();
	controller.reset();
	changed();
});
