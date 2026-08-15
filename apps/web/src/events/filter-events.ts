import type { PlanuEvent } from "../lib/types.js";

export interface DateRange {
	from?: Date | null | undefined;
	to?: Date | null | undefined;
}

/** Coincide si el término aparece en el título o en la descripción. */
function matchesSearch(event: PlanuEvent, term: string): boolean {
	if (term === "") return true;
	if (event.title.toLowerCase().includes(term)) return true;
	return event.description?.toLowerCase().includes(term) ?? false;
}

/**
 * Solape entre el evento y el rango, con criterio inclusivo.
 *
 * Dos reglas heredadas del prototipo que no son obvias:
 * - Un evento **sin fechas** pasa siempre el filtro. La alternativa —ocultarlo—
 *   haría desaparecer eventos que el usuario sí quiere ver.
 * - Con un solo extremo del rango, ese extremo hace de los dos, así que filtrar
 *   por un único día busca los eventos activos ese día, no los que empiezan.
 */
function matchesRange(event: PlanuEvent, range: DateRange): boolean {
	const { from, to } = range;
	if (!from && !to) return true;

	const start = event.startDate ?? null;
	const end = event.endDate ?? null;
	if (!start && !end) return true;

	const rangeStart = from ?? to;
	const rangeEnd = to ?? from;
	if (!rangeStart || !rangeEnd) return true;

	if (start && !end) return start <= rangeEnd;
	if (!start && end) return end >= rangeStart;
	if (start && end) return start <= rangeEnd && end >= rangeStart;

	return false;
}

/**
 * Filtra por texto y por rango de fechas. Ambos criterios se suman.
 *
 * Genérica para no perder por el camino lo que el llamante añada al evento,
 * como el `id` que trae de Firestore.
 */
export function filterEvents<T extends PlanuEvent>(
	events: readonly T[],
	searchTerm = "",
	range: DateRange = {},
): T[] {
	const term = searchTerm.trim().toLowerCase();
	return events.filter(
		(event) => matchesSearch(event, term) && matchesRange(event, range),
	);
}
