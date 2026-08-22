import { createContext } from "@lit/context";

/**
 * Analítica de activación (T31, ADR 0009), del lado del dominio.
 *
 * Cinco eventos y no más — `page_view` lo emite el adaptador de GA4 por su
 * cuenta en cada navegación; los otros cuatro los dispara cada caso de uso al
 * ocurrir el hecho. **Nunca contenido del usuario**: cada método sólo acepta
 * lo que necesita para el evento, nunca una cadena que alguien haya escrito.
 *
 * Este puerto no sabe que existe Firebase. El adaptador —el único sitio que
 * sí— decide si hay proveedor configurado, si el navegador lo soporta, y
 * traga cualquier fallo: medir activación no puede ser la razón de que algo
 * se rompa. Un componente sin adaptador real recibe un puerto que no hace
 * nada, no un `undefined` que haya que comprobar en cada llamada.
 */
export interface AnalyticsPort {
	/** Al completar el registro, email o Google. */
	trackSignUp(): void;
	/** Al primer evento que la cuenta llega a ver —propio o compartido—. */
	trackFirstEventCreated(): void;
	/** Al enviar una invitación desde el diálogo de compartir. */
	trackShare(params: { editable: boolean }): void;
	/** Al generar un evento con IA, desde imagen o desde texto pegado. */
	trackAiUsed(params: { fromImage: boolean }): void;
}

/**
 * Implementación que no hace nada. Es el puerto por defecto para quien
 * consuma `analyticsContext` sin que `main.ts` haya provisto un adaptador
 * real —tests, Storybook si llega, cualquier entorno sin Analytics
 * configurado—, y evita que cada llamador compruebe `port?.trackShare(...)`.
 */
export const noopAnalytics: AnalyticsPort = {
	trackSignUp() {},
	trackFirstEventCreated() {},
	trackShare() {},
	trackAiUsed() {},
};

/**
 * Contexto de Lit para el puerto. Valor por defecto `noopAnalytics`, no
 * `undefined`: así ningún componente necesita comprobar si hay analítica
 * antes de llamar a `track*()` — la comprobación vive una sola vez, aquí.
 */
export const analyticsContext = createContext<AnalyticsPort>(
	Symbol("planu-analytics"),
);
