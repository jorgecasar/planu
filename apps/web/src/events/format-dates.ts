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

const FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
};

/**
 * Texto legible del periodo de un evento.
 *
 * Las cuatro combinaciones importan: el modelo permite eventos sin fechas, con
 * sólo inicio o con sólo fin, y cada caso dice algo distinto al usuario.
 */
export function formatEventDates(
	start: Date | null | undefined,
	end: Date | null | undefined,
	locale?: string,
): string {
	const format = (date: Date) =>
		new Intl.DateTimeFormat(locale, FORMAT).format(date);

	if (start && end) return `${format(start)} – ${format(end)}`;
	if (start) return `Starts ${format(start)}`;
	if (end) return `Ends ${format(end)}`;
	return "No specific date";
}
