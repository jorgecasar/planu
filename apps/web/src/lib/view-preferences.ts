import {
	DEFAULT_SORT,
	parseSortPreference,
	type SortPreference,
	serializeSortPreference,
} from "../domain/sort-events.js";
import {
	DEFAULT_VIEW,
	parseViewMode,
	type ViewMode,
} from "../domain/view-mode.js";

/**
 * Prefijo propio para no chocar con nada más en el mismo origen, y sufijo con
 * la vista a la que pertenece: una clave llamada `sort` a secas no diría de qué.
 */
const SORT_KEY = "planu.events.sort";

/** La vista elegida —tarjetas, calendario o agenda—, junto a la del orden. */
const VIEW_KEY = "planu.events.view";

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

/**
 * La vista que el usuario dejó puesta. Lo que decide qué es válido vive en
 * `domain/view-mode.ts`; aquí sólo queda el acceso al almacenamiento.
 *
 * Mismo `try` que arriba y por el mismo motivo: nombrar `localStorage` puede
 * lanzar `SecurityError` antes de leer nada, y un navegador restrictivo debe
 * perder la preferencia, no la pantalla.
 */
export function readViewMode(storage?: Storage): ViewMode {
	try {
		return parseViewMode((storage ?? localStorage).getItem(VIEW_KEY));
	} catch {
		return DEFAULT_VIEW;
	}
}

/** Guardar la vista es una comodidad: si falla, no se avisa de nada. */
export function writeViewMode(mode: ViewMode, storage?: Storage): void {
	try {
		(storage ?? localStorage).setItem(VIEW_KEY, mode);
	} catch {
		// Cuota llena o almacenamiento denegado. La vista sigue funcionando.
	}
}
