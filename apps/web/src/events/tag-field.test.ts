import { expect, test, vi } from "vitest";
import { MAX_TAG_LENGTH } from "../domain/tags.js";
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
