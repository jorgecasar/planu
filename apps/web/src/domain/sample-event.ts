import { msg } from "@lit/localize";
import type { PlanuEvent } from "../lib/types.js";

/**
 * Un evento de ejemplo, para quien pulsa "probar con un evento de ejemplo" en
 * el estado vacío (T33). Se entrega como borrador -el mismo mecanismo que ya
 * usa el editor para lo que propone la IA (T24/T27)-, así que el usuario lo
 * revisa y decide si lo guarda: nunca se escribe solo.
 *
 * Fábrica y no una constante de módulo: `msg()` se evalúa al llamarla, y un
 * valor calculado al importar congelaría el idioma del primer render, igual
 * que ya advierte `eventSchema()` en `lib/types.ts`.
 *
 * `now` entra como parámetro y no se lee con `new Date()` dentro: es una
 * entrada, no un detalle de implementación, y así el resultado se puede
 * comprobar sin depender de cuándo corran los tests.
 */
export function sampleEventDraft(now: Date = new Date()): Partial<PlanuEvent> {
	// Una semana vista y no una fecha fija: la vista separa próximos de pasados
	// por el instante actual, así que un dato fijo dejaría de "verse" próximo
	// con el paso del tiempo. Mismo razonamiento que `scripts/seed-emulator.js`.
	const startDate = new Date(now);
	startDate.setDate(startDate.getDate() + 7);
	startDate.setHours(19, 0, 0, 0);

	const endDate = new Date(startDate);
	endDate.setHours(21, 0, 0, 0);

	return {
		title: msg("Dinner with friends"),
		description: msg(
			"A sample event, so you can see how it looks. Change anything you like, then save it — or delete it once you are done.",
		),
		location: msg("At home"),
		startDate,
		endDate,
	};
}
