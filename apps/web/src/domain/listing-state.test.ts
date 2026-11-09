import { expect, test } from "vitest";
import { type ListingInput, listingState } from "./listing-state.js";

const ready: ListingInput = {
	status: "ready",
	total: 3,
	visible: 3,
	ownership: "all",
	narrowed: false,
};

test("un error se anuncia aunque haya eventos", () => {
	expect(listingState({ ...ready, status: "error" })).toBe("error");
	expect(
		listingState({ ...ready, status: "error", total: 0, visible: 0 }),
	).toBe("error");
});

test("sin contexto o cargando no se concluye que no hay eventos", () => {
	const empty = { ...ready, total: 0, visible: 0 };
	expect(listingState({ ...empty, status: undefined })).toBe("loading");
	expect(listingState({ ...empty, status: "loading" })).toBe("loading");
});

test("con eventos visibles se pinta la lista", () => {
	expect(listingState(ready)).toBe("list");
	expect(listingState({ ...ready, visible: 1, narrowed: true })).toBe("list");
});

test("sin ningún evento se ofrece crear uno, filtre lo que filtre", () => {
	const none = { ...ready, total: 0, visible: 0 };
	expect(listingState(none)).toBe("no-events");
	expect(listingState({ ...none, ownership: "shared", narrowed: true })).toBe(
		"no-events",
	);
});

test("si sólo filtra la bandeja, el motivo es la bandeja", () => {
	const filtered = { ...ready, visible: 0 };
	expect(listingState({ ...filtered, ownership: "shared" })).toBe(
		"none-shared",
	);
	expect(listingState({ ...filtered, ownership: "mine" })).toBe("none-mine");
	expect(listingState({ ...filtered, ownership: "all" })).toBe("no-match");
});

test("con una búsqueda encima, el motivo es la búsqueda", () => {
	const filtered = { ...ready, visible: 0, narrowed: true };
	expect(listingState({ ...filtered, ownership: "shared" })).toBe("no-match");
	expect(listingState({ ...filtered, ownership: "mine" })).toBe("no-match");
});
