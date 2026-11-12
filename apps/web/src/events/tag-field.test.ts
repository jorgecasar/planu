import { html, render } from "lit";
import { expect, test, vi } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../domain/tags.js";
import { TagField } from "./tag-field.js";

const LENGTH_ERROR = `A tag must be ${MAX_TAG_LENGTH} characters or fewer.`;

function setup(error = "") {
	const host = { requestUpdate: vi.fn() };
	const state = { error };
	const field = new TagField(host, {
		getError: () => state.error,
		setError: (message) => {
			state.error = message;
		},
	});
	return { host, state, field };
}

test("reset() normaliza las etiquetas, vacía lo escrito y repinta", () => {
	const { host, field } = setup();
	field.draft = "a medias";
	field.reset(["  Música ", "música", "Cine"]);
	expect(field.tags).toEqual(["música", "cine"]);
	expect(field.draft).toBe("");
	expect(host.requestUpdate).toHaveBeenCalled();
});

test("añadir normaliza, vacía lo escrito y no repite; vacío no hace nada", () => {
	const { field } = setup();
	field.draft = "cine";
	field.add("  ");
	expect(field.draft).toBe("cine");
	field.add(" Cine ");
	expect(field.tags).toEqual(["cine"]);
	expect(field.draft).toBe("");
	field.draft = "cine";
	field.add("CINE");
	expect(field.tags).toEqual(["cine"]);
	expect(field.draft).toBe("");
	field.remove("cine");
	expect(field.tags).toEqual([]);
});

test("demasiado larga avisa y conserva lo escrito; la siguiente válida retira el aviso", () => {
	const { field, state } = setup();
	const long = "x".repeat(MAX_TAG_LENGTH + 1);
	field.draft = long;
	field.add(long);
	expect(state.error).toBe(LENGTH_ERROR);
	expect(field.draft).toBe(long);
	expect(field.tags).toEqual([]);
	field.add("cine");
	expect(state.error).toBe("");
	state.error = "The image could not be uploaded.";
	field.add("teatro");
	expect(state.error).toBe("The image could not be uploaded.");
});

test("Enter añade lo escrito sin enviar el formulario; otra tecla no", () => {
	const { field } = setup();
	field.draft = "teatro";
	const press = (key: string) =>
		new KeyboardEvent("keydown", { key, cancelable: true });
	field.onKey(press(","));
	expect(field.tags).toEqual([]);
	const enter = press("Enter");
	field.onKey(enter);
	expect(enter.defaultPrevented).toBe(true);
	expect(field.tags).toEqual(["teatro"]);
});

test("lo escrito se lee del campo real, el del origen del evento", () => {
	const { host, field } = setup();
	const input = document.createElement("input");
	input.value = "cin";
	input.addEventListener("input", (event) => field.onInput(event));
	input.dispatchEvent(new Event("input"));
	expect(field.draft).toBe("cin");
	expect(host.requestUpdate).toHaveBeenCalledOnce();
});

function paint(field: TagField, knownTags: readonly string[] = []) {
	const root = document.createElement("div");
	const ai = vi.fn((full: boolean) => html`<p>ai ${full}</p>`);
	render(html`${field.render(knownTags, ai)}`, root);
	const all = (selector: string) => [...root.querySelectorAll(selector)];
	const texts = (selector: string) =>
		all(selector).map((each) => each.textContent?.trim());
	const click = (selector: string) =>
		all(selector)[0]?.dispatchEvent(new Event("click"));
	return { root, ai, texts, click };
}

test("pinta las elegidas con su botón de quitar y sugiere las conocidas", () => {
	const { field } = setup();
	field.reset(["teatro"]);
	field.draft = "ci";
	const { click, texts } = paint(field, ["cine", "circo", "teatro", "museo"]);
	expect(texts("ul.chosen wa-tag")).toEqual(["teatro"]);
	expect(texts("ul.suggestions wa-button")).toEqual(["cine", "circo"]);
	expect(texts(".tags > p")).toEqual(["ai false"]);

	click("ul.suggestions wa-button");
	expect(field.tags).toEqual(["teatro", "cine"]);
	click("ul.chosen wa-button");
	expect(field.tags).toEqual(["cine"]);
});

test("llena, deshabilita el campo, deja de sugerir y se lo dice a la IA", () => {
	const { field } = setup();
	field.reset(Array.from({ length: MAX_TAGS }, (_, i) => `tag ${i}`));
	const { root, ai, texts } = paint(field, ["cine"]);
	expect(root.querySelector("#tag")?.hasAttribute("disabled")).toBe(true);
	expect(root.querySelector("ul.suggestions")).toBeNull();
	expect(ai).toHaveBeenCalledWith(true);
	expect(texts("ul.chosen wa-tag")).toHaveLength(MAX_TAGS);
});
