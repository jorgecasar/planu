/**
 * Errores ocurridos antes de que el SDK de Sentry esté cargado.
 *
 * La observabilidad se carga en diferido, después del primer pintado, porque
 * adelantarla cuesta LCP. El precio es una ventana ciega de un par de segundos
 * —y es justo la ventana donde se manifiesta un despliegue roto: un chunk que
 * no baja, Firebase que no inicializa, `initLocale()` que falla—. Esos errores
 * eran invisibles.
 *
 * Esto los guarda desde la primera línea de `main.ts` y los reenvía cuando el
 * SDK termina de cargar. Sentry recomienda inicializar «lo antes posible»; ésta
 * es la forma de cumplir la intención sin pagar el coste de arranque.
 */

/** Tope deliberadamente bajo: un fallo en bucle no debe comerse la memoria. */
const MAX = 10;

const buffered: unknown[] = [];
let listening = false;

function record(reason: unknown): void {
	if (buffered.length < MAX) buffered.push(reason);
}

function onError(event: ErrorEvent): void {
	record(event.error ?? new Error(event.message));
}

function onRejection(event: PromiseRejectionEvent): void {
	record(event.reason);
}

/**
 * Empieza a escuchar. Debe llamarse antes que cualquier otra cosa, y es
 * síncrono y sin dependencias a propósito: si esto necesitara cargar algo,
 * volvería a existir la ventana ciega que viene a cerrar.
 */
export function captureStartupErrors(): void {
	if (listening) return;
	listening = true;
	globalThis.addEventListener("error", onError);
	globalThis.addEventListener("unhandledrejection", onRejection);
}

/**
 * Reenvía lo acumulado y se aparta.
 *
 * Los manejadores propios se retiran: a partir de aquí escucha el SDK, y
 * dejarlos puestos duplicaría cada error.
 */
export function flushStartupErrors(sentry: {
	captureException: (e: unknown) => unknown;
}): void {
	globalThis.removeEventListener("error", onError);
	globalThis.removeEventListener("unhandledrejection", onRejection);
	listening = false;

	while (buffered.length > 0) {
		const reason = buffered.shift();
		try {
			sentry.captureException(reason);
		} catch {
			// Si el propio reenvío falla no hay a dónde reportarlo, y desde
			// luego no debe tumbar la aplicación.
		}
	}
}

/** Sólo para los tests: vacía el estado del módulo entre casos. */
export function resetStartupBuffer(): void {
	globalThis.removeEventListener("error", onError);
	globalThis.removeEventListener("unhandledrejection", onRejection);
	listening = false;
	buffered.length = 0;
}
