import {
	DEFAULT_SORT,
	parseSortPreference,
	type SortPreference,
	serializeSortPreference,
} from "../domain/sort-events.js";

/**
 * Prefijo propio para no chocar con nada más en el mismo origen, y sufijo con
 * la vista a la que pertenece: vendrán más preferencias (T21) y una clave
 * llamada `sort` a secas no diría de qué.
 */
const SORT_KEY = "planu.events.sort";

/**
 * Todo lo que decide qué es válido vive en `domain/sort-events.ts`. Aquí sólo
 * queda el acceso al almacenamiento, que es lo único que no se puede probar
 * como función pura.
 *
 * `storage` es opcional y se resuelve **dentro** del `try`, no como valor por
 * defecto del parámetro: en un iframe con el almacenamiento denegado, el mero
 * hecho de nombrar `localStorage` lanza `SecurityError`, y evaluado en la firma
 * ocurriría antes de entrar al `try`. Así, un navegador restrictivo pierde la
 * preferencia pero no el listado.
 */
export function readSortPreference(storage?: Storage): SortPreference {
	try {
		return parseSortPreference((storage ?? localStorage).getItem(SORT_KEY));
	} catch {
		return { ...DEFAULT_SORT };
	}
}

/** Guardar la preferencia es una comodidad: si falla, no se avisa de nada. */
export function writeSortPreference(
	preference: SortPreference,
	storage?: Storage,
): void {
	try {
		(storage ?? localStorage).setItem(
			SORT_KEY,
			serializeSortPreference(preference),
		);
	} catch {
		// Cuota llena o almacenamiento denegado. El listado sigue funcionando.
	}
}
