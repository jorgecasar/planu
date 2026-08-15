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
import { flushStartupErrors } from "./startup-buffer.js";

/** Espera a que el navegador esté ocioso, o a un plazo si no lo soporta. */
function whenIdle(task: () => void): void {
	const idle = (
		globalThis as { requestIdleCallback?: (cb: () => void) => number }
	).requestIdleCallback;

	if (idle) idle(task);
	else setTimeout(task, 3000);
}

/**
 * Espera al pintado del contenido principal, y sólo entonces al ocio.
 *
 * `requestIdleCallback` por sí solo **no** espera al pintado: dispara en el
 * primer hueco de inactividad, y ese hueco llega antes. Medido en producción,
 * los chunks de Sentry y de Firebase Performance se descargaban entre los 1142
 * y los 1251 ms, con el LCP en 1481 ms: competían por ancho de banda y por
 * hilo principal justo en la ventana que peor lo tolera.
 *
 * El doble `requestAnimationFrame` resuelve eso: el segundo corre después de
 * que el compositor haya pintado el frame que encoló el primero.
 */
function afterMainPaint(task: () => void): void {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			whenIdle(task);
		});
	});
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

	// Desestructurado y no como espacio de nombres: con `import * as Sentry`,
	// Rollup conserva el módulo entero y Session Replay viajaba igualmente.
	const {
		init,
		captureException,
		globalHandlersIntegration,
		browserApiErrorsIntegration,
		breadcrumbsIntegration,
		dedupeIntegration,
		functionToStringIntegration,
		inboundFiltersIntegration,
	} = await import("@sentry/browser");

	init({
		dsn,
		// No se declara `sendDefaultPii`: su valor por defecto ya es `false` y
		// la opción está deprecada —desaparece en la v11 del SDK—. Los eventos
		// son de un planificador privado y no hay motivo para mandar cabeceras
		// ni direcciones IP, así que el defecto es justo lo que queremos.
		release: import.meta.env.VITE_RELEASE,
		// Sólo errores. Las trazas de rendimiento las da Firebase Performance,
		// y activarlas aquí duplicaría coste y peso.
		tracesSampleRate: 0,
		// Explícitas y no las de por defecto: sin esta lista, `init` referencia
		// el conjunto completo y Rollup no puede descartar Session Replay ni el
		// widget de Feedback. Iban en el bundle —455 KiB en crudo, con un 83 %
		// sin usar— para no ejecutarse nunca.
		defaultIntegrations: false,
		integrations: [
			globalHandlersIntegration(),
			browserApiErrorsIntegration(),
			breadcrumbsIntegration(),
			dedupeIntegration(),
			functionToStringIntegration(),
			inboundFiltersIntegration(),
		],
	});

	flushStartupErrors({ captureException });
}

/** Métricas de usuarios reales: es lo que el laboratorio no puede medir. */
async function startPerformanceMonitoring(app: FirebaseApp): Promise<void> {
	const { getPerformance } = await import("firebase/performance");
	getPerformance(app);
}

/** Arranca la observabilidad. Nunca lanza: no debe romper la aplicación. */
export function startObservability(app: FirebaseApp): void {
	if (import.meta.env.DEV) return;

	afterMainPaint(() => {
		void startErrorTracking().catch(() => {
			// Si el propio seguimiento de errores falla, no hay a dónde
			// reportarlo y desde luego no debe tumbar la aplicación.
		});
		void startPerformanceMonitoring(app).catch(() => {});
	});
}
