import { expect, test } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../domain/tags.js";
import "./event-editor.js";
import type { PlanuEventEditor } from "./event-editor.js";

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
