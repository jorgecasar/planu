import {
	type GroupOptions,
	groupOf,
	sortEvents,
} from "../domain/sort-events.js";
import type { PlanuEvent } from "../lib/types.js";
import { dayKey, safeLocale } from "./month-grid.js";

/** Un día de la agenda: la fecha, cómo se escribe, y lo que hay ese día. */
export interface AgendaDay<T> {
	/** El día como entero comparable. Ver `dayKey`. */
	key: number;
	/**
	 * El día que representa, **a las 12:00 locales**, por el mismo motivo que en
	 * `MonthCell`: hay husos donde la medianoche no existe un día al año y el
	 * motor devuelve la 01:00. El mediodía existe siempre.
	 */
	date: Date;
	/** Fecha completa según el locale, para encabezar el día. */
	label: string;
	events: T[];
}

/**
 * La agenda: días con contenido, más los eventos que no tienen fecha.
 *
 * Los tres montones son los de `groupEvents`, y eso es deliberado: no se
 * inventa una semántica nueva de «pasado» ni de «sin fecha» para esta vista.
 */
export interface Agenda<T> {
	upcoming: AgendaDay<T>[];
	undated: T[];
	past: AgendaDay<T>[];
}

/** Cuántos eventos hay repartidos en una lista de días. */
export function countEvents<T>(days: readonly AgendaDay<T>[]): number {
	return days.reduce((total, day) => total + day.events.length, 0);
}

/**
 * El día por el que un evento entra en la agenda.
 *
 * Es **el mismo extremo por el que `sortEvents` lo ordena** (`startDate ??
 * endDate`), y no por casualidad: si la agenda agrupara por un día distinto del
 * que decide la posición, la lista dejaría de ser monótona en su propia clave y
 * el mismo día aparecería dos veces separado por otro.
 *
 * Es también una semántica **distinta** de la de `eventSpan`, que reparte el
 * evento por todos los días que ocupa. Allí tiene sentido —una celda del mes
 * enseña una línea por evento y así se ve el tramo—; aquí un congreso de tres
 * días repetiría su tarjeta entera tres veces en una lista que se recorre
 * hacia abajo. En la agenda cada evento sale **una vez**, el día que empieza.
 */
function anchorOf(event: PlanuEvent): Date | null {
	return event.startDate ?? event.endDate ?? null;
}

/** El mediodía local del día al que pertenece una fecha. */
function noonOf(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

export type AgendaOptions = GroupOptions;

/**
 * Reparte los eventos en días.
 *
 * Ordena primero con la preferencia del usuario y reparte después, igual que
 * `groupEvents`: así **el orden elegido manda también sobre la secuencia de
 * días**. Con «fecha, lo más próximo primero» —el valor por defecto— los días
 * salen en orden cronológico ascendente, que es la agenda que pide F5; con
 * «fecha, lo más lejano primero» salen al revés, que es lo que el usuario acaba
 * de pedir. El día se coloca donde aparece su primer evento, de modo que la
 * secuencia de días es siempre la del propio orden y no una segunda ordenación
 * que pudiera contradecirlo.
 */
export function buildAgenda<T extends PlanuEvent>(
	events: readonly T[],
	options: AgendaOptions,
): Agenda<T> {
	const { now, sort } = options;

	// Se sanea **una vez y para los dos usos**. `Intl.Collator` lanza
	// `RangeError` con una etiqueta inválida exactamente igual que
	// `Intl.DateTimeFormat`, así que proteger sólo el formateador dejaba la
	// agenda entera reventando dentro de `sortEvents` con la misma entrada que
	// aquí ya se daba por controlada.
	const locale = safeLocale(options.locale);

	const format = new Intl.DateTimeFormat(locale, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});

	const upcoming = new Map<number, AgendaDay<T>>();
	const past = new Map<number, AgendaDay<T>>();
	const undated: T[] = [];

	for (const event of sortEvents(events, sort, locale)) {
		const anchor = anchorOf(event);

		// Sin ninguno de los dos extremos, que es exactamente lo que `groupEvents`
		// entiende por «sin fecha». No hay día en el que ponerlo sin inventarlo.
		if (anchor === null) {
			undated.push(event);
			continue;
		}

		// Próximo o pasado lo decide el dominio, no esta función: pasado es haber
		// **terminado**, y un congreso de tres días sigue siendo próximo el
		// segundo aunque su día de entrada ya quedara atrás.
		const days = groupOf(event, now) === "past" ? past : upcoming;
		const key = dayKey(anchor);
		const day = days.get(key);

		if (day) {
			day.events.push(event);
		} else {
			const date = noonOf(anchor);
			days.set(key, { key, date, label: format.format(date), events: [event] });
		}
	}

	return {
		upcoming: [...upcoming.values()],
		undated,
		past: [...past.values()],
	};
}
