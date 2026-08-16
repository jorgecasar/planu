/**
 * Generación de iCalendar (RFC 5545) como texto, sin tocar el DOM ni la red.
 *
 * Todo lo que decide qué sale en el fichero vive aquí, para que lo que se
 * prueba sea la cadena y no el navegador. La parte impura —`Blob`, object URL
 * y `<a download>`— está en `lib/download-file.ts`.
 */

/**
 * Lo mínimo que hace falta para exportar un evento.
 *
 * Estructural y no `StoredEvent` a propósito: así `domain/` no depende de
 * `lib/types.ts`, que arrastra Zod y el `Timestamp` de Firestore. Un
 * `StoredEvent` encaja aquí sin conversión.
 */
export interface CalendarEvent {
	id: string;
	title: string;
	description?: string | undefined;
	location?: string | undefined;
	startDate?: Date | null | undefined;
	endDate?: Date | null | undefined;
}

export interface IcsOptions {
	/**
	 * Momento de generación, que va en `DTSTAMP`.
	 *
	 * Obligatorio y no `new Date()` por defecto: con el reloj implícito, un test
	 * del fichero generado no es reproducible y acaba probando la hora del
	 * sistema en vez del formato.
	 */
	now: Date;
	/**
	 * Parte derecha del `UID`, tras la arroba. RFC 5545 pide un identificador
	 * globalmente único y la convención es un dominio bajo nuestro control.
	 */
	uidDomain?: string;
}

const CRLF = "\r\n";
const PRODID = "-//planu//planu calendar export//EN";
const ENCODER = new TextEncoder();

/** Los `.ics` se sirven así; el `charset` importa porque el texto va en UTF-8. */
export const ICS_MIME_TYPE = "text/calendar;charset=utf-8";

/**
 * Quita los caracteres de control, que RFC 5545 §3.1 no admite en un valor:
 * `VALUE-CHAR = WSP / %x21-7E / NON-US-ASCII`. Sólo el tabulador se salva.
 *
 * Se filtra porque el título, la descripción y la ubicación son texto libre sin
 * saneado, y un carácter de control pegado desde otro sitio hace que varios
 * lectores rechacen el fichero **entero**, no la propiedad.
 *
 * Sin expresión regular: escribir los controles en una clase de caracteres es
 * justo lo que prohíbe `noControlCharactersInRegex`, y recorrer puntos de
 * código se lee igual de bien.
 */
function stripControls(value: string): string {
	let clean = "";
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		// Tabulador, o cualquier cosa a partir del espacio que no sea DEL.
		if (code === 0x09 || (code >= 0x20 && code !== 0x7f)) clean += char;
	}
	return clean;
}

/**
 * Escapa un valor TEXT.
 *
 * La barra invertida va primero: si se escapase después, duplicaría las barras
 * que acaban de introducir los otros reemplazos y el texto llegaría corrupto al
 * calendario.
 *
 * Los saltos de línea se convierten antes de filtrar controles, para que una
 * descripción multilínea conserve sus líneas en vez de perderlas.
 */
export function escapeText(value: string): string {
	return stripControls(
		value
			.replace(/\\/g, "\\\\")
			.replace(/;/g, "\\;")
			.replace(/,/g, "\\,")
			.replace(/\r\n|\r|\n/g, "\\n"),
	);
}

/**
 * Pliega una línea a 75 **octetos**, no a 75 caracteres.
 *
 * Es la diferencia que hace inválido un fichero con acentos o emoji: en UTF-8
 * un carácter ocupa de uno a cuatro octetos, así que 75 caracteres pueden ser
 * 300 octetos. Se itera por puntos de código —`for…of`, no por índice— para no
 * partir un carácter por la mitad ni separar un par suplente.
 *
 * Las líneas de continuación empiezan por un espacio, y ese espacio cuenta
 * dentro del límite: de ahí que a partir de la segunda el presupuesto sea 74.
 */
export function foldLine(line: string): string {
	const segments: string[] = [];
	let current = "";
	let bytes = 0;
	let limit = 75;

	for (const char of line) {
		const size = ENCODER.encode(char).length;
		if (bytes + size > limit) {
			segments.push(current);
			current = "";
			bytes = 0;
			// 74 y no 75 a partir del segundo tramo: RFC 5545 §3.1 acota la línea
			// a 75 octetos **incluido** el espacio con el que empieza una
			// continuación, así que el contenido dispone de uno menos. Con 75 la
			// segunda línea salía de 76 y el fichero dejaba de ser válido.
			limit = 74;
		}
		current += char;
		bytes += size;
	}
	segments.push(current);

	return segments.join(`${CRLF} `);
}

function pad(value: number, length = 2): string {
	return String(value).padStart(length, "0");
}

/** `YYYYMMDD`, con los componentes locales: es la fecha que eligió el usuario. */
export function toIcsDate(date: Date): string {
	return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * `YYYYMMDDTHHMMSSZ`, en UTC.
 *
 * La forma con `Z` evita tener que emitir un `VTIMEZONE` con las reglas de
 * horario de verano de la zona del usuario, que es la otra manera de que una
 * hora local no sea ambigua.
 */
export function toIcsDateTime(date: Date): string {
	return (
		`${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
		`T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
	);
}

function nextDay(date: Date): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + 1);
	return next;
}

/**
 * Si el instante es el **comienzo de su día local**, que es lo que el editor
 * guarda para una fecha sin hora.
 *
 * Se compara contra `new Date(año, mes, día)` en vez de mirar `getHours() === 0`
 * porque hay zonas donde la medianoche no existe: en Chile, Cuba, Paraguay o
 * Líbano el reloj se adelanta a las 00:00, así que el 6 de septiembre de 2026 en
 * Santiago el día empieza a la 01:00. Con la comprobación ingenua, un evento
 * creado con un `<input type="date">` dejaba de ser de día completo y se
 * exportaba como una cita puntual de duración cero. Ambas expresiones sufren la
 * misma normalización del salto, así que comparadas coinciden.
 */
function isStartOfDay(date: Date): boolean {
	const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	return start.getTime() === date.getTime();
}

export interface CalendarWindow {
	start: Date;
	/**
	 * Fin del evento, **exclusivo** cuando es de día completo: el día siguiente
	 * al último. Así lo define RFC 5545 y así lo espera Google, y por eso lo
	 * calcula esta función una sola vez en lugar de cada consumidor.
	 *
	 * `null` sólo cuando el evento tiene hora y no declara fin.
	 */
	end: Date | null;
	allDay: boolean;
}

/**
 * Cuándo ocurre el evento, o `null` si no hay forma de saberlo.
 *
 * Dos decisiones que el modelo obliga a tomar:
 * - Un evento con sólo fecha de fin se exporta empezando ese día, porque
 *   RFC 5545 exige `DTSTART` en todo `VEVENT` sin `METHOD`.
 * - Es de día completo si todas las fechas que trae son el comienzo de su día
 *   local, que es lo que produce un `<input type="date">`. Se deduce porque el
 *   modelo no tiene bandera de «todo el día»; si algún día la lleva, este
 *   detector sobra y el dato manda.
 */
export function calendarWindow(event: CalendarEvent): CalendarWindow | null {
	const start = event.startDate ?? event.endDate ?? null;
	if (!start) return null;

	const declaredEnd = event.startDate ? (event.endDate ?? null) : null;
	const allDay =
		isStartOfDay(start) && (!declaredEnd || isStartOfDay(declaredEnd));

	if (allDay) return { start, end: nextDay(declaredEnd ?? start), allDay };

	// Con hora, un fin que no es posterior al inicio se omite: RFC 5545 §3.8.2.2
	// exige que `DTEND` sea estrictamente posterior, y el esquema admite inicio
	// igual a fin. Un `VEVENT` con hora y sin `DTEND` es válido y significa
	// duración cero, que es exactamente lo que pidió el usuario.
	return {
		start,
		end: declaredEnd && declaredEnd > start ? declaredEnd : null,
		allDay,
	};
}

/** Un evento sin ninguna fecha no se puede exportar; se avisa en vez de exportarlo. */
export function isExportable(event: CalendarEvent): boolean {
	return calendarWindow(event) !== null;
}

/**
 * `UID` del evento.
 *
 * Sale del identificador del documento, que es único dentro de la colección y
 * no cambia nunca. Eso es justo lo que pide RFC 5545: exportar dos veces el
 * mismo evento produce el mismo `UID`, así que el calendario **actualiza** la
 * entrada en lugar de duplicarla, y dos eventos distintos nunca colisionan. Un
 * `UID` aleatorio —o derivado del título, que se edita— llenaría la agenda de
 * copias en cada exportación.
 */
function uid(event: CalendarEvent, domain: string): string {
	// Sin identificador no hay `UID` estable, y el que saldría —`@planu.app` o
	// `undefined@planu.app`— sería **el mismo para todos**: el calendario los
	// tomaría por versiones de un único evento y dejaría uno solo. Mejor parar
	// aquí que vaciarle la agenda a alguien. Hoy no llega ninguno, pero T20 y
	// T21 empiezan a pasear borradores sin guardar.
	if (!event.id) {
		throw new TypeError("Un evento sin identificador no se puede exportar.");
	}
	return `${event.id}@${domain}`;
}

function veventLines(
	event: CalendarEvent,
	window: CalendarWindow,
	options: Required<IcsOptions>,
): string[] {
	const { start, end, allDay } = window;
	const lines = [
		"BEGIN:VEVENT",
		`UID:${escapeText(uid(event, options.uidDomain))}`,
		`DTSTAMP:${toIcsDateTime(options.now)}`,
		allDay
			? `DTSTART;VALUE=DATE:${toIcsDate(start)}`
			: `DTSTART:${toIcsDateTime(start)}`,
	];

	if (end) {
		lines.push(
			allDay
				? `DTEND;VALUE=DATE:${toIcsDate(end)}`
				: `DTEND:${toIcsDateTime(end)}`,
		);
	}

	lines.push(`SUMMARY:${escapeText(event.title)}`);
	if (event.description) {
		lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	}
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
	lines.push("END:VEVENT");

	return lines;
}

/**
 * Construye el calendario completo.
 *
 * Los eventos sin fechas se omiten en lugar de emitir un `VEVENT` sin
 * `DTSTART`, que hace que algunos calendarios rechacen el fichero entero: un
 * evento de menos es mejor que una agenda que no se puede importar. Quien
 * llama comprueba antes con `isExportable()` para poder avisar.
 */
export function buildIcs(
	events: readonly CalendarEvent[],
	options: IcsOptions,
): string {
	const resolved: Required<IcsOptions> = {
		now: options.now,
		uidDomain: options.uidDomain ?? "planu.app",
	};

	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${PRODID}`,
		"CALSCALE:GREGORIAN",
	];

	for (const event of events) {
		const window = calendarWindow(event);
		if (!window) continue;
		lines.push(...veventLines(event, window, resolved));
	}

	lines.push("END:VCALENDAR");

	// El plegado se aplica al final y a todas por igual: así ninguna propiedad
	// nueva puede olvidarse de plegar.
	return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/**
 * Nombre de fichero a partir del título.
 *
 * Sin acentos ni signos, porque el nombre viaja por una cabecera de descarga y
 * por sistemas de ficheros con reglas distintas. Si no queda nada utilizable
 * —un título en otro alfabeto— se cae a un nombre genérico antes que a un
 * fichero llamado `.ics`.
 */
export function icsFileName(title: string): string {
	const slug = title
		.normalize("NFD")
		// Los diacríticos que NFD acaba de separar de su letra.
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);

	return `${slug === "" ? "event" : slug}.ics`;
}
