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
 * Whose events to show.
 *
 * Now that an event can have guests, the listing mixes your own with what
 * other people shared, and the two need separating.
 */
export type OwnershipFilter = "all" | "mine" | "shared";

/**
 * Ownership is decided by `userId` alone. Roles need not be consulted: in
 * someone else's event you are a guest by definition, and with an empty uid —
 * a session not yet resolved — nothing counts as yours, which is the safe way
 * round.
 */
function matchesOwnership(
	event: PlanuEvent,
	uid: string,
	ownership: OwnershipFilter,
): boolean {
	if (ownership === "all") return true;

	const isOwner = uid !== "" && event.userId === uid;
	return ownership === "mine" ? isOwner : !isOwner;
}

/**
 * Todas las etiquetas seleccionadas deben estar en el evento: se combinan con
 * **Y**, no con **O** (F6).
 *
 * Con **O**, añadir una etiqueta al filtro amplía el resultado, y eso hace
 * inútil el filtro en cuanto el usuario tiene unas cuantas. Con **Y** cada
 * etiqueta que se añade acota, que es lo que se espera de un filtro.
 *
 * Las seleccionadas se dan por normalizadas: salen de las que ya usa el
 * usuario, no de texto tecleado.
 */
function matchesTags(event: PlanuEvent, selected: readonly string[]): boolean {
	if (selected.length === 0) return true;
	return selected.every((tag) => event.tags.includes(tag));
}

export interface EventFilters extends DateRange {
	searchTerm?: string;
	ownership?: OwnershipFilter;
	/** Who is looking. Without it, "mine" means nothing. */
	uid?: string;
	/** Combined with AND: an event must carry all of them. */
	tags?: readonly string[];
}

/**
 * Filters by text, by date range, by ownership and by tag. The criteria add
 * up: all four must hold.
 *
 * Generic so nothing the caller attached to the event is lost on the way, such
 * as the `id` it carries from Firestore.
 */
export function filterEvents<T extends PlanuEvent>(
	events: readonly T[],
	searchTerm = "",
	range: DateRange = {},
	ownership: OwnershipFilter = "all",
	uid = "",
	tags: readonly string[] = [],
): T[] {
	const term = searchTerm.trim().toLowerCase();
	return events.filter(
		(event) =>
			matchesSearch(event, term) &&
			matchesRange(event, range) &&
			matchesOwnership(event, uid, ownership) &&
			matchesTags(event, tags),
	);
}
