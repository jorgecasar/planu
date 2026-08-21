import { expect, test } from "vitest";
import { MAX_TAGS } from "../domain/tags.js";
import { eventSchema } from "./types.js";

/**
 * Lo mínimo que el esquema exige, sin `tags`.
 *
 * A propósito **sin** enumerar la clave: el defecto que estos tests fijan sólo
 * se veía así. `toEvent` la enumeraba a mano y por eso el listado funcionaba;
 * el esquema, por su cuenta, rechazaba el documento entero.
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
	// Es el caso de todo lo escrito antes de F6, y el que las reglas contemplan
	// dejando `tags` fuera de `hasAll`. Sin el `.optional()`, Zod 4 lo tiraba
	// con `invalid_type` y el evento desaparecía del listado con un aviso en la
	// consola.
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
	// Las reglas ya lo denegarían al escribir, pero los documentos del prototipo
	// nunca pasaron por ellas.
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
	// Aquí sí manda `MAX_TAGS`: son las etiquetas de un evento, no el
	// vocabulario del usuario.
	const muchas = Array.from({ length: MAX_TAGS + 3 }, (_, i) => `t${i}`);
	const result = parse({ tags: muchas });
	expect(result.data?.tags).toHaveLength(MAX_TAGS);
});

test("un título corto sigue invalidando el evento entero", () => {
	// Control: el saneado de `tags` es una excepción deliberada, no una licencia
	// para que el esquema deje pasar cualquier cosa.
	expect(parse({ title: "ab" }).success).toBe(false);
});

test("allDay por defecto es true (evento sin el campo)", () => {
	// Los eventos anteriores a esta feature no traen allDay y deben leerse
	// como día completo. default(true) lo garantiza.
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
