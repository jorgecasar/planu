import { msg } from "@lit/localize";

/**
 * Las tres formas de mirar los mismos eventos.
 *
 * Son una **presentación**, no un filtro: las tres reciben exactamente la misma
 * lista, la que devuelve `filterEvents`. Si alguna vez una vista tuviera que
 * consultar otra cosa, dejaría de ser un modo de vista y sería otra pantalla.
 */
export type ViewMode = "grid" | "calendar" | "agenda";

/**
 * La rejilla de tarjetas: es la que existía antes del conmutador, así que quien
 * nunca lo toque ve lo mismo que veía.
 */
export const DEFAULT_VIEW = "grid" as const satisfies ViewMode;

/**
 * Las vistas que el conmutador ofrece, **y las únicas que se aceptan al leer la
 * preferencia guardada**.
 *
 * Una sola lista, por el mismo motivo que en `sort-events.ts`: los `value` de
 * los controles y lo que se valida al leer de `localStorage` tienen que ser la
 * misma cosa, o cambiar uno deja el conmutador sin opción marcada y nadie se
 * entera.
 */
const OFFERED = [
	{ value: "grid", label: () => msg("Cards") },
	{ value: "calendar", label: () => msg("Calendar") },
	{ value: "agenda", label: () => msg("Agenda") },
] as const satisfies readonly { value: ViewMode; label: () => string }[];

export const OFFERED_VIEWS: readonly ViewMode[] = OFFERED.map(
	(entry) => entry.value,
);

/**
 * Lee lo que se guardó, sin fiarse.
 *
 * Basura, `null`, o el nombre de una vista que ya no existe caen a la rejilla.
 * Una preferencia corrupta no puede dejar la pantalla sin ninguna vista.
 */
export function parseViewMode(raw: string | null | undefined): ViewMode {
	return OFFERED_VIEWS.find((mode) => mode === raw) ?? DEFAULT_VIEW;
}

/** Una entrada del conmutador, ya con su etiqueta traducida. */
export interface ViewOption {
	value: ViewMode;
	label: string;
}

/**
 * Fábrica y no constante: `msg()` se evalúa al llamarlo, así que una lista
 * construida al importar el módulo congelaría el idioma de ese instante.
 */
export function viewOptions(): ViewOption[] {
	return OFFERED.map(({ value, label }) => ({ value, label: label() }));
}
