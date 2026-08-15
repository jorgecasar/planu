import { expect, test } from "vitest";
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
