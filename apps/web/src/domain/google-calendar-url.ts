import {
	type CalendarEvent,
	calendarWindow,
	toIcsDate,
	toIcsDateTime,
} from "./build-ics.js";

/**
 * Enlace a la plantilla de creación de eventos de Google Calendar.
 *
 * Es una URL, no una integración: no hay red, ni credenciales, ni permiso que
 * pedir. El usuario llega al formulario de Google con los campos rellenos y
 * decide si guarda.
 *
 * La plantilla admite **un** evento, así que la agenda completa sólo se
 * exporta como `.ics`.
 */
const TEMPLATE = "https://calendar.google.com/calendar/render";

/**
 * `null` cuando el evento no tiene fechas: sin `dates` la plantilla se abre
 * vacía de horario y el usuario cree que el enlace ha fallado. Quien llama
 * avisa en su lugar.
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
	const window = calendarWindow(event);
	if (!window) return null;

	const { start, end, allDay } = window;
	// Google usa el mismo criterio que RFC 5545: fechas sueltas para el día
	// completo —con fin exclusivo, que ya viene calculado— y marca de tiempo
	// UTC en el resto. Sin fin declarado se repite el inicio, porque el
	// parámetro exige los dos extremos.
	const dates = allDay
		? `${toIcsDate(start)}/${toIcsDate(end ?? start)}`
		: `${toIcsDateTime(start)}/${toIcsDateTime(end ?? start)}`;

	// `URLSearchParams` se encarga del escape; construir la cadena a mano es
	// donde un título con `&` rompe el resto de parámetros.
	const params = new URLSearchParams({
		action: "TEMPLATE",
		text: event.title,
		dates,
	});
	if (event.description) params.set("details", event.description);
	if (event.location) params.set("location", event.location);

	return `${TEMPLATE}?${params.toString()}`;
}
