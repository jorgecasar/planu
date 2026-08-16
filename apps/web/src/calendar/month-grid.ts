import type { PlanuEvent } from "../lib/types.js";

/**
 * Día de la semana con la numeración de `Date.prototype.getDay()`:
 * 0 = domingo … 6 = sábado.
 *
 * No es la de `Intl.Locale.prototype.getWeekInfo()`, que sigue la ISO 8601
 * (1 = lunes … 7 = domingo). La conversión se hace en un solo sitio, abajo.
 */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const SUNDAY: WeekDay = 0;
const MONDAY: WeekDay = 1;
const FRIDAY: WeekDay = 5;
const SATURDAY: WeekDay = 6;

/**
 * Las regiones cuya semana **no** empieza en lunes, que es el caso mayoritario
 * y hace de valor por defecto.
 *
 * Las tres tablas no están escritas a mano: salen de recorrer los 676 códigos
 * de región de dos letras preguntándole a `getWeekInfo()` al propio ICU. Una
 * tabla a ojo daba sábado por lunes en catorce regiones árabes y no podía ni
 * representar el viernes de Maldivas.
 *
 * Un test vuelve a recorrer los 676 y compara las dos rutas, así que el
 * respaldo está **atado a la versión de ICU del navegador con el que probamos**.
 * Si ese test falla nombrando una región, es un dato que se ha movido y lo que
 * toca es regenerar la tabla, no arreglar la lógica. Ya hay precedente: Node 24
 * e ICU de Chromium discrepan hoy en Islandia.
 */
const FRIDAY_REGIONS = new Set(["MV"]);

const SATURDAY_REGIONS = new Set([
	"AF",
	"BH",
	"DJ",
	"DZ",
	"EG",
	"IQ",
	"IR",
	"JO",
	"KW",
	"LY",
	"OM",
	"QA",
	"SD",
	"SY",
]);

const SUNDAY_REGIONS = new Set([
	"AG",
	"AS",
	"BD",
	"BR",
	"BS",
	"BT",
	"BU",
	"BW",
	"BZ",
	"CA",
	"CO",
	"DM",
	"DO",
	"ET",
	"GT",
	"GU",
	"HK",
	"HN",
	"ID",
	"IL",
	"IN",
	"IS",
	"JM",
	"JP",
	"JT",
	"KE",
	"KH",
	"KR",
	"LA",
	"MH",
	"MI",
	"MM",
	"MO",
	"MT",
	"MX",
	"MZ",
	"NI",
	"NP",
	"NT",
	"PA",
	"PE",
	"PH",
	"PK",
	"PR",
	"PT",
	"PU",
	"PY",
	"PZ",
	"RH",
	"SA",
	"SG",
	"SV",
	"TH",
	"TT",
	"TW",
	"UM",
	"US",
	"VE",
	"VI",
	"WK",
	"WS",
	"YD",
	"YE",
	"ZA",
	"ZW",
]);

/**
 * Primer día de la semana según el locale, sin `getWeekInfo()`.
 *
 * La región sale de `maximize()`, no de partir la etiqueta por guiones: en
 * `de-u-ca-gregory` el primer trozo de dos letras es `ca`, y darlo por Canadá
 * dejaba el alemán empezando la semana en domingo.
 *
 * Se exporta para poder probarla: en Chromium `getWeekInfo()` existe siempre y
 * este camino quedaría sin ejercitar, que es como se cuela un respaldo roto.
 */
export function fallbackFirstDayOfWeek(locale: string | undefined): WeekDay {
	if (!locale) return MONDAY;

	let region: string | undefined;
	try {
		const tag = new Intl.Locale(locale);
		// La región explícita manda sobre la que infiere `maximize()`, que ante
		// una desconocida —`und-ZZ`— se inventa `US` y devolvía domingo.
		region = tag.region ?? tag.maximize().region;
	} catch {
		return MONDAY;
	}

	if (!region) return MONDAY;
	if (FRIDAY_REGIONS.has(region)) return FRIDAY;
	if (SATURDAY_REGIONS.has(region)) return SATURDAY;
	if (SUNDAY_REGIONS.has(region)) return SUNDAY;

	return MONDAY;
}

/**
 * `getWeekInfo()` todavía no está en las librerías de TypeScript, y declararlo
 * opcional es además lo correcto: no todos los navegadores lo traen.
 */
type LocaleWithWeekInfo = Intl.Locale & {
	getWeekInfo?: () => { firstDay: number };
};

/**
 * Primer día de la semana del locale activo.
 *
 * `Intl.Locale.prototype.getWeekInfo()` no es Baseline widely available, así que
 * va detrás de detección de disponibilidad y degrada a la tabla de arriba, tal y
 * como manda el soporte de navegador del proyecto.
 */
export function firstDayOfWeek(locale?: string): WeekDay {
	// Sin locale, el del entorno; `navigator` no, que aquí no hay documento.
	const tag = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;

	try {
		const info = (new Intl.Locale(tag) as LocaleWithWeekInfo).getWeekInfo?.();
		// La ISO numera 1 = lunes … 7 = domingo; `getDay()`, 0 = domingo.
		if (info) return (info.firstDay % 7) as WeekDay;
	} catch {
		// Etiqueta de locale inválida: mejor el respaldo que reventar la vista.
	}

	return fallbackFirstDayOfWeek(tag);
}

/**
 * Una etiqueta de locale que `Intl` acepte, o `undefined` para usar la del
 * entorno.
 *
 * `Intl.DateTimeFormat` lanza `RangeError` con una etiqueta mal formada, y
 * `buildMonthGrid` construye cuatro. Sin este filtro, un `locale` cualquiera
 * llegado desde fuera dejaba la vista en blanco: `firstDayOfWeek()` sí se
 * protegía, pero era el único sitio protegido de todo el camino.
 */
export function safeLocale(locale?: string): string | undefined {
	if (locale === undefined) return undefined;

	try {
		return new Intl.DateTimeFormat(locale).resolvedOptions().locale;
	} catch {
		return undefined;
	}
}

/**
 * Identifica un día del calendario local con un entero comparable: 20260629.
 *
 * Es lo que permite decidir si un evento cae en una celda **sin restar fechas**.
 * Comparar marcas de tiempo obligaría a razonar sobre husos y cambios de hora;
 * comparar campos locales es exactamente la pregunta que hace el calendario.
 */
export function dayKey(date: Date): number {
	return (
		date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
	);
}

/**
 * Días que ocupa un evento, como par de claves inclusivo.
 *
 * Cuatro reglas, y ninguna es obvia:
 * - Sin ninguna fecha no ocupa ningún día: `null`. Una celda **es** una fecha, y
 *   colocarlo en una nos obligaría a inventarla. Esos eventos salen aparte en
 *   `undated`, y la vista los ofrece en una lista al lado en vez de limitarse a
 *   contarlos: un evento que existe pero no se puede alcanzar está perdido.
 * - **Sin fin, dura desde su inicio en adelante.** No es un punto en el tiempo:
 *   es algo que empezó y no ha terminado. Se pinta hasta el final de la rejilla
 *   visible, y vuelve a pintarse en los meses siguientes, porque sigue vigente.
 * - **Sin inicio, dura desde hoy hasta su fin.** Un fin sin inicio es una fecha
 *   límite, y lo útil es ver cuánto queda; si el fin ya pasó, se pinta sólo ese
 *   día para no llenar el pasado con algo que ya no está en curso.
 * - Con el fin antes del inicio —dato incoherente que el esquema rechaza pero
 *   que pudo guardarse antes— se colapsa al día de inicio en vez de no pintar
 *   nada.
 *
 * Es una semántica **distinta** de la de `domain/filter-events.ts`, donde un
 * solo extremo hace de los dos, y está decidido así a propósito: allí se
 * pregunta «¿solapa este evento con el rango que he pedido?», y aquí «¿en qué
 * días está en curso?». La misma respuesta no sirve a las dos preguntas.
 */
function eventSpan(
	event: PlanuEvent,
	windowEnd: number,
	today: number,
): [number, number] | null {
	const start = event.startDate ?? null;
	const end = event.endDate ?? null;

	if (start && end) {
		const from = dayKey(start);
		const to = dayKey(end);
		return to >= from ? [from, to] : [from, from];
	}

	// Sin fin: abierto hacia adelante, acotado por lo que se está pintando.
	if (start) {
		const from = dayKey(start);
		return [from, Math.max(from, windowEnd)];
	}

	// Sin inicio: desde hoy hasta el fin. Si el fin ya pasó, sólo ese día.
	if (end) {
		const to = dayKey(end);
		return to >= today ? [today, to] : [to, to];
	}

	return null;
}

/** Una celda de la rejilla: un día del calendario y lo que ocurre en él. */
export interface MonthCell<T> {
	/**
	 * El día que representa, **a las 12:00 locales**.
	 *
	 * Y no a medianoche, aunque sea lo natural, por dos motivos que se suman.
	 * Hay husos donde las 00:00 no existen un día al año —Santiago, La Habana,
	 * Asunción, Beirut— y el motor devuelve la 01:00; peor aún, `setDate()`
	 * conserva la hora del cursor, así que ese desfase **no se corrige solo**:
	 * en Santiago 2024 toda la rejilla desde el 8 de septiembre se quedaba a la
	 * 01:00. El mediodía existe en todos los husos y en todos los días, porque
	 * ningún salto real de horario lo alcanza.
	 *
	 * Importa porque `date` es campo público y sus consumidores —el `.ics` de
	 * T22, el primero— van a leerlo esperando el día, no un instante.
	 */
	date: Date;
	/** El día como entero comparable. Ver `dayKey`. */
	key: number;
	/** `false` en los días de relleno del mes anterior o del siguiente. */
	inMonth: boolean;
	isToday: boolean;
	/** Fecha completa según el locale, para etiquetar la celda. */
	label: string;
	/** Número del día, formateado según el locale. */
	day: string;
	/** Eventos activos ese día, en el orden en que llegaron. */
	events: T[];
}

/** Cabecera de columna: el nombre del día en corto y en largo. */
export interface WeekdayHeading {
	short: string;
	long: string;
}

export interface MonthGrid<T> {
	/** Primer día del mes representado. */
	month: Date;
	/** Mes y año según el locale: «junio de 2026». */
	title: string;
	/** Los siete días, empezando por el primero de la semana del locale. */
	weekdays: WeekdayHeading[];
	/** Semanas completas: entre cuatro y seis, nunca parciales. */
	weeks: MonthCell<T>[][];
	/** Eventos sin ninguna fecha. No caben en el calendario; ver `eventSpan`. */
	undated: T[];
}

/**
 * Reparte los eventos en las celdas del mes.
 *
 * Función pura: todo lo que puede variar —el mes, el locale y qué día es hoy—
 * entra por parámetro. Sin eso no habría forma de probar el cambio de horario
 * de verano sin esperar a marzo.
 *
 * La rejilla siempre trae semanas completas, así que arrastra días del mes
 * anterior y del siguiente. Son días reales y llevan sus eventos: un evento que
 * empieza el 30 de junio y acaba el 2 de julio se ve entero en las dos vistas.
 *
 * **El avance de día se hace con `setDate()`, nunca sumando 86 400 000 ms.**
 * Un día no siempre dura 24 horas: el 25 de octubre de 2026 en Madrid dura 25,
 * y la suma de milisegundos deja el cursor en las 23:00 de ese mismo día. A
 * partir de ahí la rejilla lo repite y pierde el último día del mes.
 * `setDate()` opera sobre campos locales y sobrevive al cambio de hora.
 *
 * Genérica para no perder por el camino nada que el llamante haya colgado del
 * evento, como el `id` que trae de Firestore.
 */
export function buildMonthGrid<T extends PlanuEvent>(
	events: readonly T[],
	month: Date,
	locale?: string,
	today: Date = new Date(),
): MonthGrid<T> {
	const year = month.getFullYear();
	const monthIndex = month.getMonth();

	// Una sola vez y para todo el camino: si la etiqueta no vale, se usa la del
	// entorno en los cuatro formateadores **y** en el primer día de la semana.
	const tag = safeLocale(locale);

	// Al mediodía por el mismo motivo que las celdas: es fecha pública.
	const first = new Date(year, monthIndex, 1, 12);
	// El día 0 del mes siguiente es el último de éste: 28, 29, 30 o 31.
	const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

	const firstDay = firstDayOfWeek(tag);
	const lead = (first.getDay() - firstDay + 7) % 7;
	const weekCount = Math.ceil((lead + daysInMonth) / 7);

	const labelFormat = new Intl.DateTimeFormat(tag, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
	const dayFormat = new Intl.DateTimeFormat(tag, { day: "numeric" });
	const shortFormat = new Intl.DateTimeFormat(tag, { weekday: "short" });
	const longFormat = new Intl.DateTimeFormat(tag, { weekday: "long" });

	const todayKey = dayKey(today);

	// El último día que esta rejilla llega a pintar, incluido el relleno del mes
	// siguiente. Es lo que acota a un evento sin fecha de fin: sigue abierto,
	// pero aquí sólo se puede pintar hasta donde hay celdas.
	const windowEndDate = new Date(year, monthIndex, 1);
	windowEndDate.setDate(windowEndDate.getDate() - lead + weekCount * 7 - 1);
	const windowEnd = dayKey(windowEndDate);

	const spans = events.map(
		(event) => [event, eventSpan(event, windowEnd, todayKey)] as const,
	);

	// Un solo cursor que avanza día a día por campos de calendario.
	const cursor = new Date(year, monthIndex, 1);
	cursor.setDate(cursor.getDate() - lead);

	const weeks: MonthCell<T>[][] = [];
	const weekdays: WeekdayHeading[] = [];

	for (let week = 0; week < weekCount; week++) {
		const cells: MonthCell<T>[] = [];

		for (let column = 0; column < 7; column++) {
			// La celda se construye desde los **campos** del cursor y al mediodía,
			// no copiando su marca de tiempo: así no hereda el desfase que el
			// cursor pueda arrastrar desde un cambio de hora. Ver `MonthCell.date`.
			const date = new Date(
				cursor.getFullYear(),
				cursor.getMonth(),
				cursor.getDate(),
				12,
			);
			const key = dayKey(date);

			if (week === 0) {
				weekdays.push({
					short: shortFormat.format(date),
					long: longFormat.format(date),
				});
			}

			cells.push({
				date,
				key,
				inMonth: date.getMonth() === monthIndex,
				isToday: key === todayKey,
				label: labelFormat.format(date),
				day: dayFormat.format(date),
				events: spans
					.filter(
						([, span]) => span !== null && key >= span[0] && key <= span[1],
					)
					.map(([event]) => event),
			});

			cursor.setDate(cursor.getDate() + 1);
		}

		weeks.push(cells);
	}

	return {
		month: first,
		title: new Intl.DateTimeFormat(tag, {
			year: "numeric",
			month: "long",
		}).format(first),
		weekdays,
		weeks,
		undated: spans.filter(([, span]) => span === null).map(([event]) => event),
	};
}
