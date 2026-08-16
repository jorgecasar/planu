import { msg } from "@lit/localize";
import type { PlanuEvent } from "../lib/types.js";

/** Los tres criterios por los que se puede ordenar el listado. */
export type SortField = "startDate" | "title" | "createdAt";

export type SortDirection = "asc" | "desc";

export interface SortPreference {
	field: SortField;
	direction: SortDirection;
}

/**
 * Lo más próximo primero: es la pregunta que trae al usuario al listado —«qué
 * tengo ahora»— y no «qué apunté ayer».
 *
 * `as const satisfies` y no `Object.freeze`: así `DEFAULT_SORT.field = "title"`
 * no compila, que es donde interesa que falle. Congelar en ejecución sólo
 * defendería de un llamante en JavaScript plano, y aquí no hay ninguno.
 */
export const DEFAULT_SORT = {
	field: "startDate",
	direction: "asc",
} as const satisfies SortPreference;

/**
 * Los órdenes que el selector ofrece, **y los únicos que se aceptan al leer la
 * preferencia guardada**.
 *
 * Que sea una sola lista es deliberado: antes las cadenas del `value` de cada
 * opción estaban escritas a mano en la plantilla y tenían que coincidir con lo
 * que produce `serializeSortPreference`. Nada lo comprobaba, así que cambiar el
 * separador dejaba el selector sin opción marcada —el usuario deja de ver qué
 * orden está aplicado— con los tests y el typecheck en verde.
 *
 * Y validar contra esta lista, y no sólo contra los tipos, cierra el otro
 * agujero: `title:desc` es un `SortPreference` legítimo que el selector no sabe
 * pintar, así que llegando desde `localStorage` dejaría la etiqueta en blanco.
 */
const OFFERED = [
	{ preference: DEFAULT_SORT, label: () => msg("Date, soonest first") },
	{
		preference: { field: "startDate", direction: "desc" },
		label: () => msg("Date, latest first"),
	},
	{
		preference: { field: "title", direction: "asc" },
		label: () => msg("Title, A to Z"),
	},
	{
		preference: { field: "createdAt", direction: "desc" },
		label: () => msg("Recently added"),
	},
] as const satisfies readonly {
	preference: Readonly<SortPreference>;
	label: () => string;
}[];

export const OFFERED_SORTS: readonly Readonly<SortPreference>[] = OFFERED.map(
	(entry) => entry.preference,
);

/**
 * Formato de persistencia: `campo:dirección`.
 *
 * Un JSON aquí sería ceremonia —dos claves, ambas de un vocabulario cerrado— y
 * además invita a leerlo con `JSON.parse`, que ante un valor corrupto lanza
 * dentro de `render()`. Una cadena plana no puede hacer eso.
 *
 * **Es un formato persistido**: cambiarlo no rompe nada visible, pero descarta
 * en silencio la preferencia de todo el que ya tenía una. Hay un test que fija
 * las cadenas literales para que sea una decisión y no un descuido.
 */
export function serializeSortPreference(preference: SortPreference): string {
	return `${preference.field}:${preference.direction}`;
}

/**
 * Lee lo que se guardó, sin fiarse.
 *
 * Todo lo que no esté en `OFFERED_SORTS` —basura, `null`, un formato de una
 * versión anterior, una combinación que el selector ya no ofrece— cae al valor
 * por defecto. El listado nunca se queda sin orden por culpa de lo que haya en
 * el almacenamiento.
 */
export function parseSortPreference(
	raw: string | null | undefined,
): SortPreference {
	const found = OFFERED_SORTS.find(
		(preference) => serializeSortPreference(preference) === raw,
	);
	return { ...(found ?? DEFAULT_SORT) };
}

/** Una entrada del selector de orden, ya con su etiqueta traducida. */
export interface SortOption {
	/** Lo que viaja en el `value` del control y en `localStorage`. */
	value: string;
	preference: Readonly<SortPreference>;
	label: string;
}

/**
 * Fábrica y no constante: `msg()` se evalúa al llamarlo, así que una lista
 * construida al importar el módulo congelaría el idioma de ese instante.
 *
 * El orden es el de `OFFERED_SORTS`, y los `value` salen de
 * `serializeSortPreference`, no de literales escritos aparte.
 */
export function sortOptions(): SortOption[] {
	return OFFERED.map(({ preference, label }) => ({
		value: serializeSortPreference(preference),
		preference,
		label: label(),
	}));
}

/** Los tres montones en los que se reparte el listado. */
export type EventGroupName = "upcoming" | "undated" | "past";

export interface EventGroups<T> {
	upcoming: T[];
	undated: T[];
	past: T[];
}

/**
 * Sin fecha es no tener **ninguna** de las dos, exactamente como lo entiende
 * `filterEvents`: allí un evento así pasa siempre el filtro de rango porque no
 * hay nada contra lo que contrastarlo. Aquí, por el mismo motivo, no puede
 * colocarse entre los fechados, así que va a su propio grupo.
 */
function isUndated(event: PlanuEvent): boolean {
	return !event.startDate && !event.endDate;
}

/**
 * El extremo por el que se ordena y el que decide si ya pasó.
 *
 * Un evento puede traer sólo uno de los dos, y `filterEvents` ya resuelve ese
 * caso haciendo que el extremo presente valga por los dos (`rangeEnd = to ??
 * from`). Se repite el criterio en lugar de inventar otro.
 */
const startOf = (event: PlanuEvent): Date | null =>
	event.startDate ?? event.endDate ?? null;

const endOf = (event: PlanuEvent): Date | null =>
	event.endDate ?? event.startDate ?? null;

/**
 * La clave por la que ordena cada criterio.
 *
 * `null` significa «no se sabe», y eso se resuelve aparte: lo desconocido va al
 * final **se pida el orden que se pida**. Invertir la dirección y encontrarse
 * arriba los eventos de los que no consta nada es exactamente lo contrario de
 * lo que se pidió al ordenar.
 */
function sortKey(event: PlanuEvent, field: SortField): number | string | null {
	switch (field) {
		case "title":
			return event.title;
		case "createdAt":
			return event.createdAt?.getTime() ?? null;
		case "startDate":
			return startOf(event)?.getTime() ?? null;
	}
}

/**
 * Ordena sin tocar el array recibido.
 *
 * Genérica para no perder por el camino lo que el llamante haya colgado del
 * evento, como el `id` que trae de Firestore.
 *
 * El desempate es **siempre por título y siempre ascendente**, también cuando
 * se pide orden descendente. Dos eventos del mismo día son un caso corriente
 * —una jornada con varias sesiones— y la lista se lee mejor si ese bloque
 * mantiene el alfabético en lugar de invertirse con el criterio principal, que
 * ahí ya no distingue nada. Si además coinciden los títulos, `Array#sort` es
 * estable y conserva el orden de entrada.
 *
 * El `locale` es opcional y sirve para probar, igual que en
 * `formatEventDates`: el orden alfabético depende del idioma —en español la
 * «ñ» va entre la «n» y la «o»— y en producción se deja al del navegador, que
 * es el que el usuario espera.
 */
export function sortEvents<T extends PlanuEvent>(
	events: readonly T[],
	preference: SortPreference = DEFAULT_SORT,
	locale?: string,
): T[] {
	const collator = new Intl.Collator(locale);
	const sign = preference.direction === "desc" ? -1 : 1;

	return [...events].sort((a, b) => {
		const left = sortKey(a, preference.field);
		const right = sortKey(b, preference.field);

		if (left === null || right === null) {
			if (right !== null) return 1;
			if (left !== null) return -1;
		} else {
			const primary =
				typeof left === "number" && typeof right === "number"
					? left - right
					: collator.compare(String(left), String(right));
			if (primary !== 0) return primary * sign;
		}

		return collator.compare(a.title, b.title);
	});
}

/**
 * A qué montón pertenece un evento respecto a un instante dado.
 *
 * Pasado es haber **terminado** antes de `now`, no haber empezado: un congreso
 * de tres días sigue siendo próximo el segundo. El límite es inclusivo, igual
 * que en `filterEvents`, así que lo que acaba justo en `now` todavía cuenta
 * como próximo.
 */
export function groupOf(event: PlanuEvent, now: Date): EventGroupName {
	if (isUndated(event)) return "undated";

	const end = endOf(event);
	return end !== null && end.getTime() < now.getTime() ? "past" : "upcoming";
}

export interface GroupOptions {
	/**
	 * El instante que separa próximos de pasados. Se inyecta a propósito: con
	 * `Date.now()` dentro, esta función no se podría probar sin depender del
	 * reloj de quien ejecuta los tests.
	 */
	now: Date;
	sort?: SortPreference;
	locale?: string | undefined;
}

/**
 * Ordena primero y reparte después, para que el criterio elegido valga dentro
 * de los tres grupos por igual. Al pasado no se le da la vuelta: el orden es
 * el que pidió el usuario, no uno distinto por grupo.
 */
export function groupEvents<T extends PlanuEvent>(
	events: readonly T[],
	options: GroupOptions,
): EventGroups<T> {
	const { now, sort = DEFAULT_SORT, locale } = options;
	const groups: EventGroups<T> = { upcoming: [], undated: [], past: [] };

	for (const event of sortEvents(events, sort, locale)) {
		groups[groupOf(event, now)].push(event);
	}

	return groups;
}

/** Lo que hace falta saber para decidir si el pliegue de pasados se abre. */
export interface PastDisclosure {
	upcoming: number;
	undated: number;
	past: number;
	/**
	 * El usuario ha acotado el listado a propósito: hay término de búsqueda o
	 * hay rango de fechas. La bandeja elegida —todos, míos, compartidos— no
	 * cuenta: es un modo de navegación, no una pregunta concreta, y cuando deja
	 * sólo pasados ya lo cubre la primera regla.
	 */
	narrowed: boolean;
}

/**
 * Si el grupo de pasados debe salir abierto.
 *
 * Plegado por defecto sigue siendo lo correcto —lo pasado es consulta, no
 * agenda—, pero plegarlo siempre esconde resultados que el usuario acaba de
 * pedir. Con tres eventos ya terminados titulados «Feria de abril» y una
 * búsqueda por «feria», `filterEvents` devuelve tres, así que no se llega al
 * mensaje de «ningún evento coincide» y la pantalla queda con una franja de
 * acordeón cerrada y **cero tarjetas**. Lo mismo con el rango puesto en un mes
 * ya pasado, donde *todos* los resultados caen dentro del pliegue.
 *
 * De ahí las dos aperturas:
 *
 * 1. **Es el único grupo con algo.** La alternativa es una página vacía que no
 *    explica nada.
 * 2. **El usuario ha buscado o ha filtrado por fechas.** Responder a una
 *    pregunta explícita con un cajón cerrado es no responderla.
 */
export function shouldRevealPast(counts: PastDisclosure): boolean {
	if (counts.past === 0) return false;
	if (counts.upcoming === 0 && counts.undated === 0) return true;
	return counts.narrowed;
}
