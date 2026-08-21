import { expect, test, vi } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../domain/tags.js";
import "./event-editor.js";
import type { PlanuEventEditor } from "./event-editor.js";

/**
 * The only point where this file touches Firebase for real: the AI SDK
 * that `#buildTagModel` dynamically imports. `vi.hoisted` because
 * `vi.mock`'s factory gets hoisted above this `const` and needs it to
 * already exist. `generateContent` is what each test reconfigures with
 * `mockResolvedValueOnce` to simulate a specific model response.
 */
interface FakeModelResponse {
	response: { text: () => string; inferenceSource: string };
}

const { generateContent, initializeDeviceModel } = vi.hoisted(() => ({
	generateContent: vi.fn(
		async (): Promise<FakeModelResponse> => ({
			response: { text: () => '{"tags":[]}', inferenceSource: "on_device" },
		}),
	),
	initializeDeviceModel: vi.fn(async (): Promise<void> => {}),
}));

vi.mock("firebase/ai", () => ({
	getAI: vi.fn(() => ({})),
	getGenerativeModel: vi.fn(() => ({ initializeDeviceModel, generateContent })),
	GoogleAIBackend: vi.fn(),
}));

const IMAGEN =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function mount(
	setup: (el: PlanuEventEditor) => void,
): Promise<PlanuEventEditor> {
	const el = document.createElement("planu-event-editor") as PlanuEventEditor;
	setup(el);
	document.body.append(el);
	await el.updateComplete;
	return el;
}

// --- The tags field ---------------------------------------------------------
//
// The native `input` that `wa-input` hides in its shadow root is what gets
// operated on, because that's what a person touches: the editor's
// handlers read `composedPath()[0]`, so an event dispatched on the host
// wouldn't carry the typed value.

type InputHost = HTMLElement & { updateComplete?: Promise<unknown> };

async function tagField(el: PlanuEventEditor): Promise<HTMLInputElement> {
	const host = el.shadowRoot?.querySelector<InputHost>("#tag");
	await host?.updateComplete;
	const inner = host?.shadowRoot?.querySelector("input");
	if (!inner) throw new Error("El campo de etiquetas no está en el DOM");
	return inner;
}

async function typeTag(el: PlanuEventEditor, text: string): Promise<void> {
	const inner = await tagField(el);
	inner.value = text;
	inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
	await el.updateComplete;
}

async function pressEnter(el: PlanuEventEditor): Promise<void> {
	const inner = await tagField(el);
	inner.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			composed: true,
			cancelable: true,
		}),
	);
	await el.updateComplete;
}

async function addTag(el: PlanuEventEditor, text: string): Promise<void> {
	await typeTag(el, text);
	await pressEnter(el);
}

const chosen = (el: PlanuEventEditor): string[] =>
	[...(el.shadowRoot?.querySelectorAll("ul.chosen wa-tag") ?? [])].map(
		(tag) => tag.textContent?.trim() ?? "",
	);

const suggested = (el: PlanuEventEditor): string[] =>
	[...(el.shadowRoot?.querySelectorAll("ul.suggestions wa-button") ?? [])].map(
		(button) => button.textContent?.trim() ?? "",
	);

const errorText = (el: PlanuEventEditor): string =>
	el.shadowRoot
		?.querySelector('wa-callout[variant="danger"]')
		?.textContent?.trim() ?? "";

test("el borrador de la IA aporta la portada del evento", async () => {
	// This is the contract between the generator and the editor: the
	// poster the event was extracted from becomes its image.
	const el = await mount((editor) => {
		editor.draft = { title: "Feria del libro", imageUrl: IMAGEN };
		editor.open = true;
	});

	const img = el.shadowRoot?.querySelector("img");
	expect(img?.getAttribute("src")).toBe(IMAGEN);

	el.remove();
});

test("el borrador prerrellena los campos del formulario", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Feria del libro", location: "Retiro" };
		editor.open = true;
	});

	const title = el.shadowRoot?.querySelector('wa-input[name="title"]');
	const location = el.shadowRoot?.querySelector('wa-input[name="location"]');
	expect((title as HTMLInputElement | null)?.value).toBe("Feria del libro");
	expect((location as HTMLInputElement | null)?.value).toBe("Retiro");

	el.remove();
});

test("sin abrir no se renderiza el formulario", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Feria del libro" };
	});

	expect(el.shadowRoot?.querySelector("form")).toBeNull();

	el.remove();
});

test("dice al usuario dónde se generó el evento", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Feria del libro" };
		editor.draftSource = "on_device";
		editor.open = true;
	});

	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"Generated on your device",
	);

	el.remove();
});

test("un alta manual no muestra el aviso de la IA", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

	el.remove();
});

test("un borrador de ejemplo (T33) avisa de que es un ejemplo, no de la IA", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Dinner with friends" };
		editor.isSample = true;
		editor.open = true;
	});

	const texto = el.shadowRoot?.querySelector("wa-callout")?.textContent ?? "";
	expect(texto).toContain("This is a sample event.");
	expect(texto).not.toContain("Generated by AI");

	el.remove();
});

test("el ejemplo también prerrellena el formulario, como cualquier borrador", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Dinner with friends", location: "At home" };
		editor.isSample = true;
		editor.open = true;
	});

	const title = el.shadowRoot?.querySelector('wa-input[name="title"]');
	expect((title as HTMLInputElement | null)?.value).toBe("Dinner with friends");

	el.remove();
});

// --- Tags --------------------------------------------------------------------

test("al abrir, las etiquetas llegan normalizadas", async () => {
	// What the AI proposes hasn't gone through `normalizeTag`, and neither
	// has a legacy event: if the editor painted them as-is, saving would
	// overwrite "Music" over "music" and the filter would see two tags
	// where there's one.
	const el = await mount((editor) => {
		editor.draft = {
			tags: ["  MÚSICA  ", "música", "  ", "x".repeat(MAX_TAG_LENGTH + 1)],
		};
		editor.open = true;
	});

	expect(chosen(el)).toEqual(["música"]);

	el.remove();
});

test("Intro añade la etiqueta ya normalizada", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	await addTag(el, "  Música  Clásica ");

	expect(chosen(el)).toEqual(["música clásica"]);
	expect((await tagField(el)).value).toBe("");

	el.remove();
});

test("repetir una etiqueta no la duplica y limpia el campo", async () => {
	// Without clearing the field, the user is left with what they just
	// typed still there, with no sign that it was already added.
	const el = await mount((editor) => {
		editor.draft = { tags: ["cine"] };
		editor.open = true;
	});

	await addTag(el, "  CINE  ");

	expect(chosen(el)).toEqual(["cine"]);
	expect((await tagField(el)).value).toBe("");

	el.remove();
});

test("pasarse de longitud avisa en vez de recortar en silencio", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	await addTag(el, "a".repeat(MAX_TAG_LENGTH + 1));

	expect(chosen(el)).toEqual([]);
	expect(errorText(el)).toContain(`${MAX_TAG_LENGTH} characters or fewer`);

	el.remove();
});

test("añadir una etiqueta no borra un aviso ajeno", async () => {
	// `error` is the channel for the whole dialog. Clearing it blindly when
	// adding a tag used to wipe out the warning that the cover hadn't been
	// uploaded, without the user having done anything about it.
	const el = await mount((editor) => {
		editor.open = true;
	});

	await addTag(el, "a".repeat(MAX_TAG_LENGTH + 1));
	// It gets replaced by a warning that isn't about the tags field.
	const callout = el.shadowRoot?.querySelector('wa-callout[variant="danger"]');
	expect(callout).not.toBeNull();
	(el as unknown as { error: string }).error =
		"The image could not be uploaded. Please try again.";
	await el.updateComplete;

	await addTag(el, "música");

	expect(chosen(el)).toEqual(["música"]);
	expect(errorText(el)).toContain("could not be uploaded");

	el.remove();
});

test("con el cupo lleno el campo se deshabilita y no se sugiere nada", async () => {
	// Offering what can't be added is noise, and a live field that ignores
	// every Enter is worse: it doesn't explain why.
	const el = await mount((editor) => {
		editor.knownTags = ["cine", "teatro"];
		editor.draft = {
			tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`),
		};
		editor.open = true;
	});

	expect(chosen(el)).toHaveLength(MAX_TAGS);
	expect(el.shadowRoot?.querySelector("#tag")?.hasAttribute("disabled")).toBe(
		true,
	);
	expect(el.shadowRoot?.querySelector("ul.suggestions")).toBeNull();

	el.remove();
});

test("las sugerencias excluyen las etiquetas ya puestas", async () => {
	const el = await mount((editor) => {
		editor.knownTags = ["cena", "cine"];
		editor.draft = { tags: ["cine"] };
		editor.open = true;
	});

	expect(suggested(el)).toEqual(["cena"]);

	el.remove();
});

test("el botón de quitar una etiqueta es alcanzable con Tab y la quita", async () => {
	// The one that `wa-tag` ships with comes out with `tabindex="-1"`, so
	// someone navigating by keyboard couldn't remove a tag added by
	// mistake. Hence the control of our own next to it.
	const el = await mount((editor) => {
		editor.draft = { tags: ["cine", "teatro"] };
		editor.open = true;
	});

	const button = el.shadowRoot?.querySelector<HTMLElement>(
		"ul.chosen li:first-child wa-button",
	);
	await (button as InputHost | null)?.updateComplete;
	const focusable = button?.shadowRoot?.querySelector("button, a");
	expect(button?.getAttribute("tabindex")).not.toBe("-1");
	expect(focusable?.getAttribute("tabindex")).not.toBe("-1");

	button?.click();
	await el.updateComplete;

	expect(chosen(el)).toEqual(["teatro"]);

	el.remove();
});

test("cambiar de evento con el editor abierto renueva las etiquetas", async () => {
	// Today there's no path that triggers this, but there was more than
	// enough reason for there to be one: reacting only to `open` left the
	// editor showing the previous event's tags with no warning at all.
	const el = await mount((editor) => {
		editor.draft = { tags: ["cine"] };
		editor.open = true;
	});
	expect(chosen(el)).toEqual(["cine"]);

	el.draft = { tags: ["teatro"] };
	await el.updateComplete;

	expect(chosen(el)).toEqual(["teatro"]);

	el.remove();
});

// --- AI tag suggestion (T24) ------------------------------------------------
//
// The quality of what the model suggests is tested separately, without the
// component, in `suggest-tags.test.ts`. Here it's only the wiring: how
// they get painted, how they get added, and when the editor even decides
// to try.

/**
 * State fields are `private` in TypeScript but public at runtime: Lit
 * doesn't know about TS visibility, and assigning to them triggers the
 * same reactivity as if they were public. The same principle is already
 * used above when setting `draft` to test the generator's result without
 * invoking it.
 */
function setState(el: PlanuEventEditor, key: string, value: unknown): void {
	(el as unknown as Record<string, unknown>)[key] = value;
}

const aiSuggested = (el: PlanuEventEditor): string[] =>
	[
		...(el.shadowRoot?.querySelectorAll("ul.ai-suggestions wa-button") ?? []),
	].map((button) => button.textContent?.trim() ?? "");

async function fillTitle(el: PlanuEventEditor, value: string): Promise<void> {
	const host = el.shadowRoot?.querySelector<InputHost>(
		'wa-input[name="title"]',
	);
	await host?.updateComplete;
	const inner = host?.shadowRoot?.querySelector("input");
	if (!inner) throw new Error("El campo de título no está en el DOM");
	inner.value = value;
	inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
	await el.updateComplete;
}

function submit(el: PlanuEventEditor): void {
	const form = el.shadowRoot?.querySelector("form") as HTMLFormElement;
	form.requestSubmit();
}

test("una sugerencia de la IA se pinta con etiqueta propia, distinta del autocompletado", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	setState(el, "aiSuggestedTags", ["música", "verano"]);
	await el.updateComplete;

	expect(aiSuggested(el)).toEqual(["música", "verano"]);
	// And it doesn't get confused with the autocomplete's "Suggested tags" list.
	expect(suggested(el)).toEqual([]);

	el.remove();
});

test("aceptar una sugerencia la añade y la quita de la lista, sin tocar las demás", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	setState(el, "aiSuggestedTags", ["música", "verano", "amigos"]);
	await el.updateComplete;

	const boton = [
		...(el.shadowRoot?.querySelectorAll("ul.ai-suggestions wa-button") ?? []),
	].find((b) => b.textContent?.trim() === "verano") as HTMLElement;
	boton.click();
	await el.updateComplete;

	expect(chosen(el)).toEqual(["verano"]);
	expect(aiSuggested(el)).toEqual(["música", "amigos"]);

	el.remove();
});

test("reabrir el editor olvida las sugerencias de la vez anterior", async () => {
	const el = await mount((editor) => {
		editor.draft = { tags: ["cine"] };
		editor.open = true;
	});
	setState(el, "aiSuggestedTags", ["música"]);
	await el.updateComplete;
	expect(aiSuggested(el)).toEqual(["música"]);

	// Closing and reopening is what triggers the `willUpdate` that resets
	// the state.
	el.open = false;
	await el.updateComplete;
	el.open = true;
	await el.updateComplete;

	expect(aiSuggested(el)).toEqual([]);

	el.remove();
});

test("guardar no depende en nada de la sugerencia: ni la mira, ni espera por ella", async () => {
	// The earlier design intercepted the first submission with no tags to
	// offer suggestions, and a review found a real bug there: the editor is
	// a single instance reused across events (`events-view.ts` toggles
	// `.open`/`.event` on the same element), so the async gap before
	// saving could let a suggestion —or the save itself— apply to the
	// wrong event if the user reopened the editor in the meantime. The
	// suggestion is now a separate button: saving is exactly the same
	// synchronous path as before T24, and this test pins that down so it
	// doesn't get coupled again.
	const el = await mount((editor) => {
		setState(editor, "firestore", {});
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Cena de prueba");
	submit(el);
	await el.updateComplete;

	// Fake Firestore: the real SDK rejects quickly and without a network,
	// so this message proves that saving was actually attempted right
	// away.
	expect(errorText(el)).toBe("The event could not be saved. Please try again.");
	expect(aiSuggested(el)).toEqual([]);

	el.remove();
});

// --- The suggest button ------------------------------------------------------

test("sin IA disponible, no se ofrece el botón: un botón que siempre falla es peor que ninguno", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags"),
	);
	expect(boton).toBeUndefined();

	el.remove();
});

test("con la IA disponible, el botón aparece", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags with AI"),
	);
	expect(boton).toBeDefined();

	el.remove();
});

test("pulsarlo sin Firebase configurado no hace nada, y no deja el botón colgado", async () => {
	// Without `appContext`, `this.app` is `undefined`: the editor doesn't
	// even try. It's the same silence T24 asks for when the AI isn't
	// available, applied to this branch too.
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags with AI"),
	) as HTMLElement;
	boton.click();
	await el.updateComplete;
	await new Promise((resolve) => setTimeout(resolve, 20));
	await el.updateComplete;

	expect(errorText(el)).toBe("");
	expect(boton.hasAttribute("disabled")).toBe(false);

	el.remove();
});

test("pulsar el botón sugiere de verdad, sin repetir lo que ya está puesto", async () => {
	// The only test that goes through the whole path: button →
	// #onSuggestTags → suggestTagsWithAi → ai-model-session → the AI SDK,
	// mocked at the real boundary and not at some point in between. It
	// also serves to check end-to-end the exclusion of already-added
	// tags, not only at the level of `suggest-tags.test.ts`.
	generateContent.mockResolvedValueOnce({
		response: {
			text: () => JSON.stringify({ tags: ["cena", "trabajo", "equipo"] }),
			inferenceSource: "on_device",
		},
	});

	const el = await mount((editor) => {
		setState(editor, "app", {});
		setState(editor, "user", { uid: "abc" });
		setState(editor, "aiAvailable", true);
		editor.draft = { tags: ["cena"] };
		editor.open = true;
	});

	await fillTitle(el, "Cena de fin de curso con el equipo");

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags with AI"),
	) as HTMLElement;
	boton.click();

	for (let i = 0; i < 40 && aiSuggested(el).length === 0; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		await el.updateComplete;
	}

	// "cena" doesn't appear: it was already added to the event.
	expect(aiSuggested(el)).toEqual(["trabajo", "equipo"]);

	el.remove();
});

test("reabrir el editor olvida una sugerencia en vuelo, no sólo una ya mostrada", async () => {
	// The same pattern as `#generation` already used by
	// `ai-event-generator.ts`: the editor doesn't unmount between events,
	// so a response that arrives late must not apply to whatever is being
	// edited by then. The download resolves right away (the default
	// mock); what's left pending is the generation itself, so as to
	// reopen right after warming up the model and before the model
	// answers.
	let resuelveGeneracion: ((value: FakeModelResponse) => void) | undefined;
	generateContent.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resuelveGeneracion = resolve;
			}),
	);

	const el = await mount((editor) => {
		setState(editor, "app", {});
		setState(editor, "user", { uid: "abc" });
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});
	await fillTitle(el, "Evento original");

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags with AI"),
	) as HTMLElement;
	boton.click();
	// Waits for the (fast) download to finish and the generation to be
	// left in flight, before reopening.
	await new Promise((resolve) => setTimeout(resolve, 20));
	await el.updateComplete;
	expect(el.shadowRoot?.textContent).toContain("Suggesting tags");

	// It closes and reopens for another event while the model keeps
	// thinking: this is exactly the scenario that invalidates the response
	// when it arrives.
	el.open = false;
	await el.updateComplete;
	el.draft = { tags: ["nuevo"] };
	el.open = true;
	await el.updateComplete;

	// Now the old request's generation is allowed to resolve.
	resuelveGeneracion?.({
		response: {
			text: () => JSON.stringify({ tags: ["tarde"] }),
			inferenceSource: "on_device",
		},
	});
	await new Promise((resolve) => setTimeout(resolve, 50));
	await el.updateComplete;

	expect(aiSuggested(el)).toEqual([]);
	expect(chosen(el)).toEqual(["nuevo"]);

	el.remove();
});
