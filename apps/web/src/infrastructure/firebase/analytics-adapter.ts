/**
 * Adaptador de Firebase Analytics (GA4) para `AnalyticsPort` (T31, ADR 0009).
 *
 * El único fichero, junto con `analytics/track.test.ts`, que sabe que la
 * analítica es GA4. Todo lo demás —los cuatro casos de uso que disparan un
 * evento— consume el puerto y no sabe qué hay detrás.
 *
 * Consent comes first (ADR 0017): until the state is `granted` the SDK is not
 * even imported, so no GA script is injected and nothing is sent. Revoking
 * later switches collection off; granting again switches it back on. Events
 * fired without consent are dropped, not queued.
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
import type { ConsentState, ConsentStore } from "../../domain/consent.js";

type Sdk = typeof import("firebase/analytics");
type Started = { sdk: Sdk; analytics: ReturnType<Sdk["getAnalytics"]> };

const safely = (run: () => void) => {
	try {
		run();
	} catch {
		// Analytics never takes the app down with it; see the file header.
	}
};

/**
 * Builds the adapter if a `measurementId` is configured; otherwise
 * `noopAnalytics`. The SDK starts lazily, the first time consent is
 * `granted`. Still async so the provider's `await` keeps working.
 */
export async function createAnalyticsAdapter(
	app: FirebaseApp,
	consent: ConsentStore,
): Promise<AnalyticsPort> {
	if (!import.meta.env["VITE_FIREBASE_MEASUREMENT_ID"]) return noopAnalytics;

	let started: Promise<Started | undefined> | undefined;
	let collecting = true;

	const start = () => {
		started ??= (async () => {
			try {
				const sdk = await import("firebase/analytics");
				if (!(await sdk.isSupported())) return undefined;
				return { sdk, analytics: sdk.getAnalytics(app) };
			} catch {
				// SDK failed to initialise: quota, network, whatever.
				return undefined;
			}
		})();
		return started;
	};

	const apply = async (state: ConsentState) => {
		const granted = state === "granted";
		if (!granted && !started) return;
		const running = await start();
		if (!running || granted === collecting) return;
		collecting = granted;
		safely(() =>
			running.sdk.setAnalyticsCollectionEnabled(running.analytics, granted),
		);
	};

	consent.subscribe((state) => void apply(state));
	void apply(consent.get());

	const log = (name: string, params?: Record<string, boolean | number>) => {
		if (consent.get() !== "granted") return;
		void start().then((running) => {
			// Consent may have been withdrawn while the SDK was loading.
			if (!running || consent.get() !== "granted") return;
			safely(() =>
				params
					? running.sdk.logEvent(running.analytics, name, params)
					: running.sdk.logEvent(running.analytics, name),
			);
		});
	};

	return {
		trackSignUp: () => log("sign_up"),
		trackFirstEventCreated: () =>
			log("first_event_created", { totalEvents: 1 }),
		trackShare: ({ editable }) => log("share", { editable }),
		trackAiUsed: ({ fromImage }) => log("ai_used", { fromImage }),
	};
}
