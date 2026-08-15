/**
 * Observabilidad: errores y rendimiento de usuarios reales.
 *
 * Todo se carga **después del primer pintado y en diferido**. Ninguna de las
 * dos cosas ayuda al usuario a ver antes su pantalla, y sumarlas al arranque
 * desharía buena parte del trabajo de rendimiento: el JavaScript inicial pasó
 * de 266 kB comprimidos a unos 124.
 *
 * Nada de esto corre en desarrollo: sólo ensuciaría el proyecto con ruido de
 * los emuladores.
 */

import type { FirebaseApp } from "firebase/app";

/** Espera a que el navegador esté ocioso, o a un plazo si no lo soporta. */
function whenIdle(task: () => void): void {
	const idle = (
		globalThis as { requestIdleCallback?: (cb: () => void) => number }
	).requestIdleCallback;

	if (idle) idle(task);
	else setTimeout(task, 3000);
}

/**
 * Seguimiento de errores.
 *
 * Sin DSN no hace nada: así el repo funciona sin cuenta de Sentry y quien
 * despliegue decide si quiere enviarlos.
 */
async function startErrorTracking(): Promise<void> {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	const Sentry = await import("@sentry/browser");
	Sentry.init({
		dsn,
		// Sin datos personales por defecto: los eventos son de un planificador
		// privado y no hay motivo para mandar cabeceras ni direcciones IP.
		sendDefaultPii: false,
		release: import.meta.env.VITE_RELEASE,
		// Sólo errores. Las trazas de rendimiento las da Firebase Performance,
		// y activarlas aquí duplicaría coste y peso.
		tracesSampleRate: 0,
	});
}

/** Métricas de usuarios reales: es lo que el laboratorio no puede medir. */
async function startPerformanceMonitoring(app: FirebaseApp): Promise<void> {
	const { getPerformance } = await import("firebase/performance");
	getPerformance(app);
}

/** Arranca la observabilidad. Nunca lanza: no debe romper la aplicación. */
export function startObservability(app: FirebaseApp): void {
	if (import.meta.env.DEV) return;

	whenIdle(() => {
		void startErrorTracking().catch(() => {
			// Si el propio seguimiento de errores falla, no hay a dónde
			// reportarlo y desde luego no debe tumbar la aplicación.
		});
		void startPerformanceMonitoring(app).catch(() => {});
	});
}
