import { expect, test } from "vitest";
import { DEFAULT_SORT, type SortPreference } from "../domain/sort-events.js";
import { readSortPreference, writeSortPreference } from "./view-preferences.js";

/** Un `Storage` de mentira, para no pisar el `localStorage` del navegador. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key: string) => data.get(key) ?? null,
		key: (index: number) => [...data.keys()][index] ?? null,
		removeItem: (key: string) => data.delete(key),
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
	} as Storage;
}

/** Lo que hace un navegador con el almacenamiento denegado o la cuota llena. */
function hostileStorage(): Storage {
	return {
		get length(): number {
			throw new DOMException("denied", "SecurityError");
		},
		clear: () => {
			throw new DOMException("denied", "SecurityError");
		},
		getItem: () => {
			throw new DOMException("denied", "SecurityError");
		},
		key: () => {
			throw new DOMException("denied", "SecurityError");
		},
		removeItem: () => {
			throw new DOMException("denied", "SecurityError");
		},
		setItem: () => {
			throw new DOMException("quota", "QuotaExceededError");
		},
	} as unknown as Storage;
}

test("lo escrito se vuelve a leer", () => {
	const storage = fakeStorage();
	const preference: SortPreference = { field: "title", direction: "asc" };

	writeSortPreference(preference, storage);

	expect(readSortPreference(storage)).toEqual(preference);
});

test("sin nada guardado, el orden por defecto", () => {
	expect(readSortPreference(fakeStorage())).toEqual(DEFAULT_SORT);
});

test("un valor corrupto no rompe el listado", () => {
	// Una versión anterior guardó otra cosa, o alguien editó el almacenamiento
	// a mano. Ninguna de las dos puede dejar la vista sin orden.
	const storage = fakeStorage({ "planu.events.sort": '{"orden":"raro"}' });

	expect(readSortPreference(storage)).toEqual(DEFAULT_SORT);
});

test("un almacenamiento denegado devuelve el orden por defecto sin lanzar", () => {
	expect(readSortPreference(hostileStorage())).toEqual(DEFAULT_SORT);
});

test("no poder guardar la preferencia no lanza", () => {
	expect(() =>
		writeSortPreference(
			{ field: "title", direction: "desc" },
			hostileStorage(),
		),
	).not.toThrow();
});

test("usa una clave con prefijo propio", () => {
	// El origen se comparte con lo que se despliegue al lado: una clave `sort`
	// a secas es una colisión esperando a ocurrir.
	const storage = fakeStorage();
	writeSortPreference({ field: "createdAt", direction: "desc" }, storage);

	expect(storage.key(0)).toBe("planu.events.sort");
});

test("sin argumento lee del localStorage real, que es como la llama la vista", () => {
	// Todos los demás tests le pasan un almacenamiento falso, así que borrar el
	// `?? localStorage` dejaba la suite verde y la preferencia sin leerse jamás.
	localStorage.setItem("planu.events.sort", "title:asc");
	try {
		expect(readSortPreference()).toEqual({ field: "title", direction: "asc" });
	} finally {
		localStorage.removeItem("planu.events.sort");
	}
});
