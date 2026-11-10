import { expect, test, vi } from "vitest";
import type {
	AiModelPort,
	AiModelRequest,
	ModelLike,
} from "../application/ports/ai-model.js";
import { MAX_TAG_LENGTH, MAX_TAGS } from "../domain/tags.js";
import "./event-editor.js";
import type { PlanuEventEditor } from "./event-editor.js";
import { TAG_SUGGESTION_SCHEMA } from "./suggest-tags.js";

/**
 * `generateContent` is what each test reconfigures with
 * `mockResolvedValueOnce` to simulate a specific model response.
 */
interface FakeModelResponse {
	response: { text: () => string; inferenceSource: string };
}

const generateContent = vi.fn(
	async (): Promise<FakeModelResponse> => ({
		response: { text: () => '{"tags":[]}', inferenceSource: "on_device" },
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

/**
 * A fake `EventRepositoryPort` that only stores what it receives. `create`
 * is what these tests exercise; `update` tags along in case a future test
 * opens the editor in edit mode.
 */
function fakeRepository() {
	const calls: { values: unknown; ownerUid?: string; id?: string }[] = [];
	return {
		calls,
		create: async (values: unknown, ownerUid: string) => {
			calls.push({ values, ownerUid });
			return { id: "new-id" };
		},
		update: async (id: string, values: unknown) => {
			calls.push({ values, id });
		},
	};
}

/** A fake `AnalyticsPort` with only `trackFirstEventCreated` mocked. */
function fakeAnalytics() {
	return {
		trackSignUp: () => {},
		trackFirstEventCreated: vi.fn(),
		trackShare: () => {},
		trackAiUsed: () => {},
	};
}

/** Reads a `wa-input`'s `.value` by its `name` attribute. */
function field(el: PlanuEventEditor, name: string): HTMLInputElement {
	const found = el.shadowRoot?.querySelector<HTMLInputElement>(
		`[name="${name}"]`,
	);
	if (!found) throw new Error(`Field "${name}" is not in the DOM`);
	return found;
}

/**
 * Writes a `wa-input`'s `.value` and waits for it to propagate to the
 * `ElementInternals` backing `FormData`.
 *
 * `wa-input` syncs its value to the form from `willUpdate()`, a Lit cycle
 * that runs asynchronously after the property is assigned. Without waiting
 * for `updateComplete` — the field's own, not just the editor's — a
 * `submit()` right after could read a value that hadn't propagated yet.
 */
async function setField(
	el: PlanuEventEditor,
	name: string,
	value: string,
): Promise<void> {
	const input = field(el, name);
	input.value = value;
	await (input as InputHost).updateComplete;
	await el.updateComplete;
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

test("la vista previa de la portada tiene un texto alternativo descriptivo", async () => {
	const el = await mount((editor) => {
		editor.draft = { title: "Feria del libro", imageUrl: IMAGEN };
		editor.open = true;
	});

	const img = el.shadowRoot?.querySelector(".cover img");
	expect(img?.getAttribute("alt")).toBe("Cover image preview");

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

// --- Dates and time (T48) ---------------------------------------------------

test("cuatro campos: fecha y hora de inicio, fecha y hora de fin", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	expect(field(el, "startDate").getAttribute("type")).toBe("date");
	expect(field(el, "startTime").getAttribute("type")).toBe("time");
	expect(field(el, "endDate").getAttribute("type")).toBe("date");
	expect(field(el, "endTime").getAttribute("type")).toBe("time");

	el.remove();
});

test("reabrir con horas guardadas las muestra en sus campos", async () => {
	// The literal acceptance criterion: "Dinner, Jul 4 19:30–23:00", reopen
	// and see 19:30 and 23:00 in their fields.
	const el = await mount((editor) => {
		editor.event = {
			id: "1",
			title: "Cena",
			startDate: new Date(2026, 6, 4, 19, 30),
			endDate: new Date(2026, 6, 4, 23, 0),
			allDay: false,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	expect(field(el, "startDate").value).toBe("2026-07-04");
	expect(field(el, "startTime").value).toBe("19:30");
	expect(field(el, "endDate").value).toBe("2026-07-04");
	expect(field(el, "endTime").value).toBe("23:00");

	el.remove();
});

test("un evento de día completo no muestra ninguna hora al reabrir", async () => {
	// The other side of the same criterion: "Vacation, Aug 1–15" with no
	// times, and none shown on reopen.
	const el = await mount((editor) => {
		editor.event = {
			id: "1",
			title: "Vacaciones",
			startDate: new Date(2026, 7, 1),
			endDate: new Date(2026, 7, 15),
			allDay: true,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	expect(field(el, "startTime").value).toBe("");
	expect(field(el, "endTime").value).toBe("");

	el.remove();
});

test("escribir una hora de inicio guarda el evento con allDay: false", async () => {
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Cena de prueba");
	await setField(el, "startDate", "2026-07-04");
	await setField(el, "startTime", "19:30");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	expect(repository.calls[0]?.values).toMatchObject({ allDay: false });

	el.remove();
});

test("escribir sólo una hora de fin también guarda el evento con allDay: false", async () => {
	// Symmetric to the startTime-alone case above: decision 4 says "writing
	// either time" declares it timed, and the flag is `startTime === "" &&
	// endTime === ""` — a mutation dropping the endTime half of that AND
	// would still pass the startTime-only test.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Cena de prueba");
	await setField(el, "endDate", "2026-07-04");
	await setField(el, "endTime", "23:00");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	expect(repository.calls[0]?.values).toMatchObject({ allDay: false });

	el.remove();
});

test("una hora sin ninguna fecha no declara el evento con hora", async () => {
	// The spec's data model is explicit: with no date, allDay "doesn't mean
	// anything — it's saved as true and never read." Filling only a time
	// field, with both date fields left empty, must not flip the flag.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Algo pendiente");
	await setField(el, "startTime", "09:00");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	expect(repository.calls[0]?.values).toMatchObject({ allDay: true });

	el.remove();
});

test("reabrir con una sola hora guardada la muestra sólo en su campo", async () => {
	// The two existing reopen tests only cover "both times set" and "both
	// times absent." A timed event legitimately has just one endpoint —
	// zero duration or an open end, decision 4 — and its round-trip render
	// wasn't checked.
	const el = await mount((editor) => {
		editor.event = {
			id: "1",
			title: "Turno",
			startDate: new Date(2026, 6, 4, 9, 0),
			endDate: null,
			allDay: false,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	expect(field(el, "startTime").value).toBe("09:00");
	expect(field(el, "endTime").value).toBe("");

	el.remove();
});

test("isFirstEvent dispara la analítica de primer evento una sola vez, no en cada alta (GH-94)", async () => {
	const repository = fakeRepository();
	const analytics = fakeAnalytics();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		setState(editor, "analytics", analytics);
		editor.isFirstEvent = true;
		editor.open = true;
	});

	await fillTitle(el, "Primer evento");
	await submitAndWaitForClose(el);

	expect(analytics.trackFirstEventCreated).toHaveBeenCalledOnce();

	// What the view does once its listing holds the new event.
	el.isFirstEvent = false;
	el.open = true;
	await el.updateComplete;
	await fillTitle(el, "Segundo evento");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(2);
	expect(analytics.trackFirstEventCreated).toHaveBeenCalledOnce();

	el.remove();
});

test("isFirstEvent se lee antes de escribir: el listado ya trae el evento nuevo cuando create() resuelve", async () => {
	// Firestore's latency compensation fires the listing's snapshot with the
	// new event before `addDoc` resolves, so the view clears the flag mid-write.
	const analytics = fakeAnalytics();
	let editor: PlanuEventEditor | undefined;
	const repository = {
		create: async () => {
			if (editor) editor.isFirstEvent = false;
			return { id: "new-id" };
		},
		update: async () => {},
	};
	const el = await mount((created) => {
		setState(created, "eventRepository", repository);
		setState(created, "user", { uid: "abc" });
		setState(created, "analytics", analytics);
		created.isFirstEvent = true;
		created.open = true;
	});
	editor = el;

	await fillTitle(el, "Primer evento");
	await submitAndWaitForClose(el);

	expect(analytics.trackFirstEventCreated).toHaveBeenCalledOnce();

	el.remove();
});

test("sin isFirstEvent no se dispara la analítica de primer evento", async () => {
	const repository = fakeRepository();
	const analytics = fakeAnalytics();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		setState(editor, "analytics", analytics);
		editor.open = true;
	});

	await fillTitle(el, "Segundo evento");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	expect(analytics.trackFirstEventCreated).not.toHaveBeenCalled();

	el.remove();
});

test("día completo con día de origen justo cuando la medianoche local no existe", async () => {
	// 6 September 2026 is the day Chile's clock jumps forward from 00:00 —
	// this suite runs under TZ=America/Santiago specifically to catch this.
	// #normalize's `new Date(year, month, day)` must still land back on the
	// 6th, not slip to the 5th or 7th because local midnight is skipped.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.event = {
			id: "1",
			title: "Turno",
			startDate: new Date(2026, 8, 6, 14, 30),
			endDate: null,
			allDay: false,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	await setField(el, "startTime", "");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	const saved = repository.calls[0]?.values as { startDate: Date };
	expect(saved.startDate.getMonth()).toBe(8);
	expect(saved.startDate.getDate()).toBe(6);

	el.remove();
});

test("borrar las dos horas devuelve el evento a día completo", async () => {
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.event = {
			id: "1",
			title: "Cena",
			startDate: new Date(2026, 6, 4, 19, 30),
			endDate: new Date(2026, 6, 4, 23, 0),
			allDay: false,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	await setField(el, "startTime", "");
	await setField(el, "endTime", "");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	expect(repository.calls[0]?.values).toMatchObject({ allDay: true });

	el.remove();
});

test("de día completo, las fechas se guardan al comienzo del día local", async () => {
	// Decision 5 of the spec: without this, an all-day event would drag along
	// a leftover time from whenever it had one, and `toIcsDate()` would stop
	// being enough.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Vacaciones");
	await setField(el, "startDate", "2026-08-01");
	await setField(el, "endDate", "2026-08-15");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	const saved = repository.calls[0]?.values as {
		allDay: boolean;
		startDate: Date;
		endDate: Date;
	};
	expect(saved.allDay).toBe(true);
	expect(saved.startDate.getHours()).toBe(0);
	expect(saved.startDate.getMinutes()).toBe(0);
	expect(saved.endDate.getHours()).toBe(0);
	expect(saved.endDate.getMinutes()).toBe(0);

	el.remove();
});

test("una hora de fin sin su propia fecha no inventa una: sigue sin fin declarado", async () => {
	// The date rules over the time, not the other way around: writing only
	// the end time without also setting its date doesn't drag in the start
	// date or any other. It's what `build-ics.test.ts` already tests for "a
	// timed event with no end doesn't emit DTEND" — here it's checked that
	// the editor doesn't flip that around.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Turno de guardia");
	await setField(el, "startDate", "2026-07-04");
	await setField(el, "startTime", "09:00");
	await setField(el, "endTime", "17:00");
	await submitAndWaitForClose(el);

	expect(repository.calls).toHaveLength(1);
	const saved = repository.calls[0]?.values as { endDate: Date | null };
	expect(saved.endDate).toBeNull();

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

/**
 * Submits the form and resolves once the editor closes itself. A successful
 * save always ends in `#close()`, which dispatches `planu-editor-close` after
 * the repository call and the first-event analytics have run, so that event
 * is the editor's own "saved" signal. If the save never succeeds, the test
 * times out instead of asserting on a half-finished save.
 */
async function submitAndWaitForClose(el: PlanuEventEditor): Promise<void> {
	const closed = new Promise<void>((resolve) => {
		el.addEventListener("planu-editor-close", () => resolve(), { once: true });
	});
	submit(el);
	await closed;
	await el.updateComplete;
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
		setState(editor, "eventRepository", {
			create: () => Promise.reject(new Error("boom")),
		});
		setState(editor, "user", { uid: "abc" });
		editor.open = true;
	});

	await fillTitle(el, "Cena de prueba");
	submit(el);
	// A rejecting fake repository, not a rejecting fake Firestore: `create()`
	// (T48) is what `#save` awaits now. A failed save closes nothing and
	// dispatches nothing, so the only signal is the error callout itself.
	await vi.waitFor(() =>
		expect(errorText(el)).toBe(
			"The event could not be saved. Please try again.",
		),
	);
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

test("pulsarlo sin puerto de IA no hace nada, y no deja el botón colgado", async () => {
	// Without `aiModelContext` the editor doesn't even try: the same
	// silence T24 asks for when the AI isn't available.
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	const boton = [...(el.shadowRoot?.querySelectorAll("wa-button") ?? [])].find(
		(b) => b.textContent?.includes("Suggest tags with AI"),
	) as HTMLElement;
	// With no port, `#onSuggestTags` returns before its first `await`: by the
	// time `click()` returns there is nothing left in flight to wait for.
	boton.click();
	await el.updateComplete;

	expect(errorText(el)).toBe("");
	expect(boton.hasAttribute("disabled")).toBe(false);

	el.remove();
});

test("pulsar el botón sugiere de verdad, sin repetir lo que ya está puesto", async () => {
	// The only test that goes through the whole path: button →
	// #onSuggestTags → suggestTagsWithAi → ai-model-session → AiModelPort,
	// faked at the boundary and not at some point in between. It
	// also serves to check end-to-end the exclusion of already-added
	// tags, not only at the level of `suggest-tags.test.ts`.
	generateContent.mockResolvedValueOnce({
		response: {
			text: () => JSON.stringify({ tags: ["cena", "trabajo", "equipo"] }),
			inferenceSource: "on_device",
		},
	});

	const el = await mount((editor) => {
		setState(editor, "aiModel", aiModel);
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

	// The suggestion chain (warm-up, generation, parsing) emits no event of
	// its own; the rendered list is the first observable result.
	// "cena" doesn't appear: it was already added to the event.
	await vi.waitFor(() =>
		expect(aiSuggested(el)).toEqual(["trabajo", "equipo"]),
	);
	expect(aiModel.build).toHaveBeenCalledWith({
		// Cloud is closed by default: ai-policy resolves on-device.
		mode: "only_on_device",
		inputs: ["text"],
		responseConstraint: TAG_SUGGESTION_SCHEMA,
	});

	el.remove();
});

test("reabrir el editor olvida una sugerencia en vuelo, no sólo una ya mostrada", async () => {
	// The pattern `ai-event-generator.ts` used to reuse before it became a
	// recreated-on-mount component: the editor doesn't unmount between
	// events, so a response that arrives late must not apply to whatever is
	// being edited by then. The download resolves right away (the default
	// mock); what's left pending is the generation itself, so as to
	// reopen right after warming up the model and before the model
	// answers.
	let resuelveGeneracion: ((value: FakeModelResponse) => void) | undefined;
	let generationStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		generationStarted = resolve;
	});
	generateContent.mockImplementationOnce(() => {
		generationStarted?.();
		return new Promise((resolve) => {
			resuelveGeneracion = resolve;
		});
	});

	const el = await mount((editor) => {
		setState(editor, "aiModel", aiModel);
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
	// left in flight, before reopening: the mocked call itself says so.
	await started;
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

	// Now the old request's generation is allowed to resolve. Discarding it
	// changes nothing on screen, so there is no positive result to wait for;
	// what can be waited for is the editor reading the late response, which
	// happens only after the model's promise resolves. `vi.waitFor` polls on
	// a timer, so by the time it sees the read, the rest of the chain
	// (parsing, the stale-token check) has run as well.
	const lateText = vi.fn(() => JSON.stringify({ tags: ["tarde"] }));
	resuelveGeneracion?.({
		response: { text: lateText, inferenceSource: "on_device" },
	});
	await vi.waitFor(() => expect(lateText).toHaveBeenCalled());
	await el.updateComplete;

	expect(aiSuggested(el)).toEqual([]);
	expect(chosen(el)).toEqual(["nuevo"]);

	el.remove();
});

// --- AI fill-in block (embedded) ---------------------------------------------
//
// `event-editor.ts` mounts `<planu-ai-event-generator>` as the first child of
// its own `<form>` when `#showAiBlock` says it's worth offering. These tests
// only exercise that wiring — visibility, the two events the block can emit,
// and that neither its buttons nor its events save the event —; the block's
// own generation machinery (image path, text path, cancellation) is already
// covered end to end in `ai-event-generator.test.ts`.

function aiBlock(el: PlanuEventEditor): Element | null {
	return el.shadowRoot?.querySelector("planu-ai-event-generator") ?? null;
}

function aiButton(el: PlanuEventEditor, text: string): HTMLElement {
	const boton = [
		...(aiBlock(el)?.shadowRoot?.querySelectorAll("wa-button") ?? []),
	].find((b) => b.textContent?.includes(text));
	if (!boton) {
		throw new Error(`No se encontró el botón "${text}" en el bloque de IA`);
	}
	return boton as HTMLElement;
}

test("con IA disponible y sin evento ni borrador, aparecen a la vez el bloque de IA y el título", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	expect(aiBlock(el)).not.toBeNull();
	expect(field(el, "title")).not.toBeNull();

	el.remove();
});

test("sin IA disponible, el bloque no aparece y el formulario vacío sigue igual que hoy", async () => {
	const el = await mount((editor) => {
		editor.open = true;
	});

	expect(aiBlock(el)).toBeNull();
	expect(field(el, "title").value).toBe("");

	el.remove();
});

test("editando un evento existente, el bloque no aparece aunque haya IA disponible", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.event = {
			id: "1",
			title: "Cena",
			allDay: true,
			memberIds: ["abc"],
			roles: {},
			tags: [],
		};
		editor.open = true;
	});

	expect(aiBlock(el)).toBeNull();

	el.remove();
});

test("con un borrador ya puesto antes de abrir, el bloque no aparece", async () => {
	// Da igual si el borrador viene de una generación real o del evento de
	// muestra de T33: `#showAiBlock` sólo mira que ya haya uno puesto.
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.draft = { title: "Feria del libro" };
		editor.open = true;
	});

	expect(aiBlock(el)).toBeNull();

	el.remove();
});

test("descartar el bloque de IA lo quita sin cerrar el editor ni vaciar el título", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});
	await fillTitle(el, "Cena de equipo");

	aiBlock(el)?.dispatchEvent(new CustomEvent("planu-generator-dismiss"));
	await el.updateComplete;

	expect(aiBlock(el)).toBeNull();
	expect(el.open).toBe(true);
	expect(field(el, "title").value).toBe("Cena de equipo");

	el.remove();
});

test("un evento generado por la IA quita el bloque, rellena el formulario y avisa de su origen", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	aiBlock(el)?.dispatchEvent(
		new CustomEvent("planu-event-generated", {
			detail: {
				event: { title: "Feria del libro", location: "Retiro" },
				source: "on_device",
			},
		}),
	);
	await el.updateComplete;

	expect(aiBlock(el)).toBeNull();
	expect(field(el, "title").value).toBe("Feria del libro");
	expect(el.shadowRoot?.querySelector("wa-callout")?.textContent).toContain(
		"Generated on your device",
	);

	el.remove();
});

test("reabrir el editor para un evento nuevo tras un descarte vuelve a mostrar el bloque", async () => {
	// `aiBlockDismissed` se resetea en el mismo bloque de `willUpdate()` que
	// ya resetea `tagDraft`, `error`, etc. al abrir.
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	aiBlock(el)?.dispatchEvent(new CustomEvent("planu-generator-dismiss"));
	await el.updateComplete;
	expect(aiBlock(el)).toBeNull();

	el.open = false;
	await el.updateComplete;
	el.open = true;
	await el.updateComplete;

	expect(aiBlock(el)).not.toBeNull();

	el.remove();
});

test("tras guardar un evento generado por la IA, reabrir para uno nuevo vuelve a mostrar el bloque con el formulario en blanco", async () => {
	// Regresión: `draft`/`draftSource` son `@property` que el padre liga
	// (`.draft=${this.draft}`) pero que el propio editor también automuta en
	// `#onAiGenerated`. Como esta instancia nunca se desmonta y el `draft`
	// del padre nunca cambió de verdad (sigue en `undefined` antes y después
	// del ciclo), el binding de lit-html nunca vuelve a invocar el setter
	// para "restaurar" ese `undefined` — así que sin un reseteo propio en
	// `#close()`, el borrador generado sobrevivía para siempre a la próxima
	// apertura de "Nuevo evento".
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	aiBlock(el)?.dispatchEvent(
		new CustomEvent("planu-event-generated", {
			detail: {
				event: { title: "Feria del libro", location: "Retiro" },
				source: "on_device",
			},
		}),
	);
	await el.updateComplete;
	expect(field(el, "title").value).toBe("Feria del libro");

	await submitAndWaitForClose(el);
	expect(repository.calls).toHaveLength(1);
	expect(el.open).toBe(false);

	el.open = true;
	await el.updateComplete;

	expect(aiBlock(el)).not.toBeNull();
	expect(field(el, "title").value).toBe("");

	el.remove();
});

test("con el bloque de IA visible y un título válido, pulsar sus botones no guarda el evento", async () => {
	// What this guards is behaviour, not the buttons' `type`: neither click
	// may save the event. A `type="submit"` there is harmless today and this
	// test can't catch it (#126): `wa-button` submits through
	// `ElementInternals.form`, and form ownership doesn't cross shadow roots,
	// so a button inside the generator's shadow root has no form owner even
	// though the generator sits inside <form id="event-form">. What it guards
	// is the editor's handlers for the block (dismiss here, generated in the
	// next test): neither may submit or save.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});
	// A valid title, so a stray submit would get past the schema and reach
	// the repository instead of being rejected for an empty form.
	await setField(el, "title", "Cena de equipo");
	const form = el.shadowRoot?.querySelector("form") as HTMLFormElement;
	let submits = 0;
	form.addEventListener("submit", () => submits++);
	// Some text so "Generate from text" is enabled: a disabled `wa-button`
	// swallows the click before it could ever reach a form.
	const generator = aiBlock(el) as unknown as {
		text: string;
		updateComplete: Promise<boolean>;
	};
	generator.text = "Cena el viernes";
	await generator.updateComplete;

	aiButton(el, "Generate from text").click();
	aiButton(el, "Write it by hand").click();
	await el.updateComplete;

	expect(submits).toBe(0);
	expect(repository.calls).toHaveLength(0);

	// Control: the same form, submitted for real, does save; the zeros above
	// are not because nothing could have been saved.
	await submitAndWaitForClose(el);
	expect(submits).toBe(1);
	expect(repository.calls).toHaveLength(1);

	el.remove();
});

test("un evento generado por la IA rellena el formulario sin guardarlo, aunque el título ya sea válido", async () => {
	// The draft is for the user to review ("Nothing is saved until you review
	// it"): handling `planu-event-generated` must not submit or save.
	const repository = fakeRepository();
	const el = await mount((editor) => {
		setState(editor, "eventRepository", repository);
		setState(editor, "user", { uid: "abc" });
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});
	await setField(el, "title", "Cena de equipo");
	const form = el.shadowRoot?.querySelector("form") as HTMLFormElement;
	let submits = 0;
	form.addEventListener("submit", () => submits++);

	// Dispatched as the generator's `#emit()` does.
	aiBlock(el)?.dispatchEvent(
		new CustomEvent("planu-event-generated", {
			detail: {
				event: { title: "Feria del libro", location: "Retiro" },
				source: "on_device",
			},
			bubbles: true,
			composed: true,
		}),
	);
	await el.updateComplete;

	expect(submits).toBe(0);
	expect(repository.calls).toHaveLength(0);
	expect(el.open).toBe(true);
	expect(field(el, "title").value).toBe("Feria del libro");
	expect(field(el, "location").value).toBe("Retiro");

	el.remove();
});

test("tras descartar el bloque de IA, el foco recae en el título", async () => {
	const el = await mount((editor) => {
		setState(editor, "aiAvailable", true);
		editor.open = true;
	});

	aiBlock(el)?.dispatchEvent(new CustomEvent("planu-generator-dismiss"));
	await el.updateComplete;

	expect(el.shadowRoot?.activeElement).toBe(field(el, "title"));

	el.remove();
});
