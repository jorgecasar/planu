/**
 * Adaptador de Firebase Analytics (GA4) para `AnalyticsPort` (T31, ADR 0009).
 *
 * El único fichero, junto con `analytics/track.test.ts`, que sabe que la
 * analítica es GA4. Todo lo demás —los cuatro casos de uso que disparan un
 * evento— consume el puerto y no sabe qué hay detrás.
 *
 * Nunca lanza. Ni al construirse —`isSupported()` puede resolver `false` con
 * un bloqueador, o rechazar en un entorno que Firebase no reconoce— ni al
 * registrar un evento. Medir activación no puede ser la razón de que algo se
 * rompa; ver `noopAnalytics` para el caso sin proveedor.
 */

import type { FirebaseApp } from "firebase/app";
import {
	type AnalyticsPort,
	noopAnalytics,
} from "../../application/ports/analytics.js";

/**
 * Construye el adaptador si hay `measurementId` configurado y el entorno lo
 * soporta; si no, `noopAnalytics`. Async porque `isSupported()` lo es —no
 * hay forma de saberlo de forma síncrona—, así que quien llama debe esperar
 * antes de proveer el contexto, igual que ya hace con Firestore y Storage.
 */
export async function createAnalyticsAdapter(
	app: FirebaseApp,
): Promise<AnalyticsPort> {
	if (!import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"]) return noopAnalytics;

	try {
		const { getAnalytics, isSupported, logEvent } = await import(
			"firebase/analytics"
		);

		if (!(await isSupported())) return noopAnalytics;

		const analytics = getAnalytics(app);
		const safely = (log: () => void) => {
			try {
				log();
			} catch {
				// Analytics never takes the app down with it; see the file header.
			}
		};
		return {
			trackSignUp() {
				safely(() => logEvent(analytics, "sign_up"));
			},
			trackFirstEventCreated() {
				safely(() =>
					logEvent(analytics, "first_event_created", { totalEvents: 1 }),
				);
			},
			trackShare({ editable }) {
				safely(() => logEvent(analytics, "share", { editable }));
			},
			trackAiUsed({ fromImage }) {
				safely(() => logEvent(analytics, "ai_used", { fromImage }));
			},
		};
	} catch {
		// Fallo al inicializar el propio SDK: cuota, red, lo que sea.
		return noopAnalytics;
	}
}
