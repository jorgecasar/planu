import { msg, str } from "@lit/localize";

/**
 * Formatea para un `<input type="date">`, que espera YYYY-MM-DD.
 *
 * Con componentes locales y no con `toISOString()`: este último pasa por UTC,
 * así que al este de Greenwich devolvía el día anterior. Un evento del 4 de
 * julio se reabría como el 3, y cada edición lo retrasaba un día más.
 */
export function toInputDate(date: Date | null | undefined): string {
	if (!date) return "";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Formatea para un `<input type="time">`, que espera HH:mm.
 *
 * Hermana de `toInputDate` y con el mismo motivo: componentes locales, no
 * UTC, porque el input vive en la hora del navegador de quien edita.
 */
export function toInputTime(date: Date | null | undefined): string {
	if (!date) return "";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
	...DATE_FORMAT,
	hour: "numeric",
	minute: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
	hour: "numeric",
	minute: "numeric",
};

/**
 * Sólo la hora, en el reloj de 12 o 24 horas que decida el locale.
 *
 * Para la celda de la rejilla mensual (T49): ahí no cabe la fecha completa de
 * `formatEventDates`, sólo la hora delante del título.
 */
export function formatEventTime(date: Date, locale?: string): string {
	return new Intl.DateTimeFormat(locale, TIME_FORMAT).format(date);
}

/** Mismo día local, para no repetir la fecha en un evento de una tarde. */
function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/**
 * Texto legible del periodo de un evento.
 *
 * Las cuatro combinaciones de fechas presentes o ausentes se multiplican por
 * dos con `allDay`: de día completo se formatea sin hora, como siempre; con
 * hora, se añade `hour`/`minute` y, si inicio y fin caen el mismo día, el fin
 * no repite la fecha —una cena de 19:30 a 23:00 no necesita el «4 jul 2026»
 * dos veces.
 */
export function formatEventDates(
	start: Date | null | undefined,
	end: Date | null | undefined,
	allDay: boolean,
	locale?: string,
): string {
	const formatFull = (date: Date) =>
		new Intl.DateTimeFormat(
			locale,
			allDay ? DATE_FORMAT : DATE_TIME_FORMAT,
		).format(date);
	const formatTime = (date: Date) =>
		new Intl.DateTimeFormat(locale, TIME_FORMAT).format(date);

	if (start && end) {
		if (!allDay && sameDay(start, end)) {
			return `${formatFull(start)} – ${formatTime(end)}`;
		}
		return `${formatFull(start)} – ${formatFull(end)}`;
	}
	if (start) return msg(str`Starts ${formatFull(start)}`);
	if (end) return msg(str`Ends ${formatFull(end)}`);
	return msg("No specific date");
}
