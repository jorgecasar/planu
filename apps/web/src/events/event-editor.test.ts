import { expect, test, vi } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../domain/tags.js";
import "./event-editor.js";
import type { PlanuEventEditor } from "./event-editor.js";

/**
 * El único punto donde este fichero toca Firebase de verdad: el SDK de IA que
 * `#buildTagModel` importa dinámicamente. `vi.hoisted` porque la factoría de
 * `vi.mock` se sube por encima de este `const` y necesita que ya exista.
 * `generateContent` es el que cada test reconfigura con `mockResolvedValueOnce`
 * para simular una respuesta concreta del modelo.
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

// --- El campo de etiquetas -------------------------------------------------
//
// Se maneja el `input` nativo que `wa-input` esconde en su shadow root, que es
// lo que toca una persona: los manejadores del editor leen
// `composedPath()[0]`, así que un evento lanzado sobre el host no traería el
// valor tecleado.

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
	// Es el contrato entre el generador y el editor: el cartel del que se
	// extrajo el evento se convierte en su imagen.
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

// --- Etiquetas -------------------------------------------------------------

test("al abrir, las etiquetas llegan normalizadas", async () => {
	// Lo que propone la IA no ha pasado por `normalizeTag`, y un evento
	// heredado tampoco: si el editor las pintase tal cual, guardar reescribiría
	// «Música» sobre «música» y el filtro vería dos etiquetas donde hay una.
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
	// Sin limpiar el campo, el usuario se queda con lo que acaba de teclear
	// delante y sin señal de que ya estaba puesta.
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
	// `error` es el canal de todo el diálogo. Limpiarlo a ciegas al añadir una
	// etiqueta se llevaba por delante el aviso de que la portada no se había
	// subido, sin que el usuario hubiese hecho nada al respecto.
	const el = await mount((editor) => {
		editor.open = true;
	});

	await addTag(el, "a".repeat(MAX_TAG_LENGTH + 1));
	// Se sustituye por un aviso que no es del campo de etiquetas.
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
	// Ofrecer lo que no se puede añadir es ruido, y un campo vivo que ignora
	// cada Intro es peor: no explica por qué.
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
	// El que trae `wa-tag` sale con `tabindex="-1"`, así que quien navega con
	// teclado no podía retirar una etiqueta puesta por error. De ahí el control
	// propio al lado.
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
	// Hoy no hay ruta que lo provoque, pero la había de sobra para que la
	// hubiese: reaccionar sólo a `open` dejaba el editor mostrando las
	// etiquetas del evento anterior sin ningún aviso.
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

// --- Sugerencia de etiquetas con IA (T24) -----------------------------------
//
// La calidad de lo que sugiere el modelo se prueba aparte, sin componente, en
// `suggest-tags.test.ts`. Aquí sólo el cableado: cómo se pintan, cómo se
// añaden, y cuándo el editor decide siquiera intentarlo.

/**
 * Los campos de estado son `private` en TypeScript pero públicos en tiempo de
 * ejecución: Lit no sabe de visibilidad de TS, y asignarlos dispara la misma
 * reactividad que si fueran públicos. Ya se usa el mismo principio más arriba
 * al fijar `draft` para probar el resultado del generador sin invocarlo.
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
	// Y no se confunde con la lista de "Suggested tags" del autocompletado.
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

	// Cerrar y reabrir es lo que dispara el `willUpdate` que resetea el estado.
	el.open = false;
	await el.updateComplete;
	el.open = true;
	await el.updateComplete;

	expect(aiSuggested(el)).toEqual([]);

	el.remove();
});

test("guardar no depende en nada de la sugerencia: ni la mira, ni espera por ella", async () => {
	// El diseño anterior interceptaba el primer envío sin etiquetas para
	// ofrecer sugerencias, y una revisión encontró ahí un fallo real: el
	// editor es una única instancia reutilizada entre eventos
	// (`events-view.ts` alterna `.open`/`.event` sobre el mismo elemento), así
	// que el hueco asíncrono antes de guardar podía dejar que una sugerencia
	// —o el propio guardado— se aplicase sobre el evento equivocado si el
	// usuario reabría el editor mientras tanto. La sugerencia es ahora un
	// botón aparte: guardar es exactamente el mismo camino síncrono de antes
	// de T24, y este test lo fija para que no vuelva a acoplarse.
	const el = await mount((editor) => {
		setState(editor, "firestore", {});
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Cena de prueba");
	submit(el);
	await el.updateComplete;

	// Firestore falso: el SDK real rechaza rápido y sin red, así que este
	// mensaje demuestra que se llegó a intentar guardar de inmediato.
	expect(errorText(el)).toBe("The event could not be saved. Please try again.");
	expect(aiSuggested(el)).toEqual([]);

	el.remove();
});

// --- El botón de sugerir --------------------------------------------------

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
	// Sin `appContext`, `this.app` es `undefined`: el editor ni siquiera lo
	// intenta. Es el mismo silencio que pide T24 para cuando la IA no está,
	// aplicado también a esta rama.
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
	// El único test que atraviesa el camino completo: botón → #onSuggestTags
	// → suggestTagsWithAi → ai-model-session → el SDK de IA, simulado en la
	// frontera real y no en un punto intermedio. Sirve además para comprobar
	// de extremo a extremo la exclusión de etiquetas ya puestas, no sólo a
	// nivel de `suggest-tags.test.ts`.
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

	// "cena" no aparece: ya estaba puesta en el evento.
	expect(aiSuggested(el)).toEqual(["trabajo", "equipo"]);

	el.remove();
});

test("reabrir el editor olvida una sugerencia en vuelo, no sólo una ya mostrada", async () => {
	// El mismo patrón de `#generation` que ya usa `ai-event-generator.ts`: el
	// editor no se desmonta entre eventos, así que una respuesta que llega
	// tarde no puede aplicarse sobre lo que se esté editando para entonces.
	// La descarga resuelve enseguida (el mock por defecto); lo que se deja
	// pendiente es la propia generación, para reabrir justo después de
	// calentar el modelo y antes de que el modelo conteste.
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
	// Espera a que la descarga (rápida) termine y la generación quede en
	// vuelo, antes de reabrir.
	await new Promise((resolve) => setTimeout(resolve, 20));
	await el.updateComplete;
	expect(el.shadowRoot?.textContent).toContain("Suggesting tags");

	// Se cierra y se reabre para otro evento mientras el modelo sigue
	// pensando: es justo el escenario que invalida la respuesta cuando llegue.
	el.open = false;
	await el.updateComplete;
	el.draft = { tags: ["nuevo"] };
	el.open = true;
	await el.updateComplete;

	// Ahora se deja resolver la generación de la petición vieja.
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
