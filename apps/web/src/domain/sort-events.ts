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
 * El extremo por el que se ordena.
 *
 * Un evento puede traer sólo uno de los dos, y `filterEvents` ya resuelve ese
 * caso haciendo que el extremo presente valga por los dos (`rangeEnd = to ??
 * from`). Se repite el criterio en lugar de inventar otro.
 */
const startOf = (event: PlanuEvent): Date | null =>
	event.startDate ?? event.endDate ?? null;

/** El último instante del día local de `date`, con precisión de milisegundo. */
function endOfDay(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		23,
		59,
		59,
		999,
	);
}

/**
 * Cuándo deja de estar en curso un evento. `null` significa «todavía no».
 *
 * Aquí **no** vale el atajo de `startOf` —el extremo presente hace de los dos—,
 * y eso costó una revisión: con `endDate ?? startDate`, unas obras que
 * empezaron el 10 de junio y no tienen fin declarado pasaban a «pasado» el 11,
 * estando en curso. La rejilla mensual las seguía pintando en el día de hoy,
 * porque `eventSpan` decide otra cosa, así que **el mismo evento salía en curso
 * en el calendario y archivado en la agenda y en las tarjetas**. Sólo se ve al
 * juntar las tres vistas, que es para lo que existe la tarea que cierra la fase.
 *
 * Manda la semántica del calendario, que es la que eligió el usuario en T20, con
 * un ajuste de T47: **de día completo, el instante que cierra el evento es el
 * final de ese día local (23:59:59.999), no su comienzo.** Sin el ajuste,
 * `endDate` de un evento de hoy vale medianoche, y a las 00:01 ya es «pasado»
 * durante el resto del día que se supone que ocurre. Sólo se puede distinguir
 * de una cita puntual a medianoche desde que existe `allDay` —`eventSchema()`
 * lo suple con `default(true)`, así que aquí llega siempre resuelto— y de ahí
 * que este arreglo llegue con esta tarea y no antes.
 *
 * - **Sin fin y con hora** (`allDay: false`), sigue en curso: no es un punto en
 *   el tiempo, es algo que empezó y no ha terminado. Nunca es pasado — el caso
 *   que ya cubría la revisión de arriba.
 * - **Sin fin y de día completo** (`allDay: true`), es un evento de un solo
 *   día: cierra al final de ese mismo día. Un día completo, a diferencia de
 *   una cita con hora, no admite «fin abierto»: el editor no ofrece esa
 *   combinación (decisión 4 del spec de horas), así que sin fin declarado sólo
 *   puede significar «dura ese día».
 * - **Sin inicio**, el fin es una fecha límite y es él quien lo cierra.
 * - **Con el fin antes del inicio** —dato incoherente que el esquema rechaza
 *   pero que pudo guardarse antes— se colapsa al inicio, igual que hace
 *   `eventSpan`. Si no, el evento caía en el pliegue de pasados bajo un
 *   encabezado de día futuro.
 *
 * Lo que **no** cambia es el orden: `sortKey` sigue mirando `startOf`, así que
 * un evento se coloca en la lista por donde empieza, no por donde acaba.
 */
function activeUntil(event: PlanuEvent): Date | null {
	const start = event.startDate ?? null;
	const end = event.endDate ?? null;
	const { allDay } = event;
	const wrap = (date: Date) => (allDay ? endOfDay(date) : date);

	if (start && end) {
		return wrap(end.getTime() >= start.getTime() ? end : start);
	}
	if (start) return allDay ? wrap(start) : null;
	return end ? wrap(end) : null;
}

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
 * de tres días sigue siendo próximo el segundo, y uno sin fin declarado nunca
 * llega a pasado (ver `activeUntil`). El límite es inclusivo, igual que en
 * `filterEvents`, así que lo que acaba justo en `now` todavía cuenta como
 * próximo.
 *
 * Esta es la **única** definición de «pasado» del proyecto: la usan la rejilla
 * de tarjetas, la agenda y —a través de `eventSpan`, que dice lo mismo con otra
 * forma— la rejilla mensual.
 */
export function groupOf(event: PlanuEvent, now: Date): EventGroupName {
	if (isUndated(event)) return "undated";

	const end = activeUntil(event);
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
