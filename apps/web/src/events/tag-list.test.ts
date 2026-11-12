import { html, render } from "lit";
import { expect, test } from "vitest";
import { renderTagList } from "./tag-list.js";

function paint(tags: readonly string[]) {
	const root = document.createElement("div");
	render(
		html`${renderTagList("chosen", "Chosen tags", tags, (tag) => html`<b>${tag}</b>`)}`,
		root,
	);
	return root.querySelector("ul");
}

test("vacía no pinta nada; si no, una lista con nombre y un elemento por etiqueta", () => {
	expect(paint([])).toBeNull();
	const list = paint(["cine", "teatro"]);
	expect(list?.className).toBe("chosen");
	expect(list?.getAttribute("aria-label")).toBe("Chosen tags");
	const items = [...(list?.querySelectorAll(":scope > li > b") ?? [])];
	expect(items.map((each) => each.textContent)).toEqual(["cine", "teatro"]);
});
