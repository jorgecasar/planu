/**
 * Observability: errors and real-user performance. Errors are Sentry's and
 * live in `../sentry/`; this file adds Firebase Performance, the only part
 * that needs the Firebase app, and starts both after the first paint.
 */

import type { FirebaseApp } from "firebase/app";
import { afterMainPaint, startErrorTracking } from "../sentry/index.js";

/** Real-user metrics: this is what the lab cannot measure. */
async function startPerformanceMonitoring(app: FirebaseApp): Promise<void> {
	const { getPerformance } = await import("firebase/performance");
	getPerformance(app);
}

/** Starts observability. Never throws: it must not break the application. */
export function startObservability(app: FirebaseApp): void {
	if (import.meta.env.DEV) return;

	afterMainPaint(() => {
		void startErrorTracking().catch(() => {
			// If error tracking itself fails, there is nowhere to report it, and
			// it must certainly not bring the application down.
		});
		void startPerformanceMonitoring(app).catch(() => {});
	});
}
