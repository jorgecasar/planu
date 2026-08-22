import { expect, test } from "vitest";
import { MAX_TAGS } from "../domain/tags.js";
import { eventSchema } from "./types.js";

/**
 * The bare minimum the schema requires, without `tags`.
 *
 * Deliberately **without** listing that key: the default these tests pin
 * down only showed up this way. `toEvent` used to list it by hand, which is
 * why the listing worked; the schema on its own rejected the whole document.
 */
const base = {
	title: "Concierto de verano",
	description: "",
	location: "",
	userId: "victima-uid",
	memberIds: ["victima-uid"],
	roles: {},
};

const parse = (extra: Record<string, unknown> = {}) =>
	eventSchema().safeParse({ ...base, ...extra });

test("un evento sin la clave tags valida y se queda sin etiquetas", () => {
	// This is the case for everything written before F6, and the one the
	// rules account for by leaving `tags` out of `hasAll`. Without the
	// `.optional()`, Zod 4 rejected it with `invalid_type` and the event
	// disappeared from the listing with a warning in the console.
	const result = parse();
	expect(result.success).toBe(true);
	expect(result.data?.tags).toEqual([]);
});

test("un tags a undefined es lo mismo que no traerlo", () => {
	const result = parse({ tags: undefined });
	expect(result.success).toBe(true);
	expect(result.data?.tags).toEqual([]);
});

test("un tags a null no tira el evento", () => {
	const result = parse({ tags: null });
	expect(result.success).toBe(true);
	expect(result.data?.tags).toEqual([]);
});

test("un tags que no es lista se descarta, no invalida el evento", () => {
	// The rules would already deny this on write, but the prototype's
	// documents never went through them.
	for (const basura of ["concierto", 42, { a: true }, true]) {
		const result = parse({ tags: basura });
		expect(result.success).toBe(true);
		expect(result.data?.tags).toEqual([]);
	}
});

test("de una lista mixta sobreviven sólo las cadenas válidas", () => {
	const result = parse({ tags: ["cine", 42, null, { a: 1 }, "  TEATRO  "] });
	expect(result.success).toBe(true);
	expect(result.data?.tags).toEqual(["cine", "teatro"]);
});

test("el esquema aplica el tope por evento a lo que lee", () => {
	// Here `MAX_TAGS` is what rules: these are one event's tags, not the
	// user's whole vocabulary.
	const muchas = Array.from({ length: MAX_TAGS + 3 }, (_, i) => `t${i}`);
	const result = parse({ tags: muchas });
	expect(result.data?.tags).toHaveLength(MAX_TAGS);
});

test("un título corto sigue invalidando el evento entero", () => {
	// Control: sanitizing `tags` is a deliberate exception, not a license for
	// the schema to let anything through.
	expect(parse({ title: "ab" }).success).toBe(false);
});

test("allDay por defecto es true (evento sin el campo)", () => {
	// Events predating this feature don't carry allDay and must be read
	// as all-day. default(true) guarantees it.
	const result = parse();
	expect(result.success).toBe(true);
	expect(result.data?.allDay).toBe(true);
});

test("allDay: false se acepta y se guarda como false", () => {
	const result = parse({ allDay: false });
	expect(result.success).toBe(true);
	expect(result.data?.allDay).toBe(false);
});

test("allDay: true explícito se acepta", () => {
	const result = parse({ allDay: true });
	expect(result.success).toBe(true);
	expect(result.data?.allDay).toBe(true);
});

test("allDay rechaza string", () => {
	const result = parse({ allDay: "true" });
	expect(result.success).toBe(false);
});

test("allDay rechaza number", () => {
	const result = parse({ allDay: 1 });
	expect(result.success).toBe(false);
});
