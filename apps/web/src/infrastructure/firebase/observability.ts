/**
 * Observability: errors and real-user performance. Errors are Sentry's and
 * live in `../sentry/`; this file adds Firebase Performance, the only part
 * that needs the Firebase app, and starts both after the first paint.
 *
 * Error tracking does not start until the visitor has granted consent, with
 * the same gate Analytics uses (`domain/consent.ts`), and withdrawing consent
 * closes it again. Whether it could instead count as strictly necessary is a
 * legal question for the owner, not a code one. Firebase Performance, which
 * also sends data and keeps an installation id, still starts unconditionally
 * here: gating it is the next card (HU-439).
 */

import type { FirebaseApp } from "firebase/app";
import {
	appConsent,
	type ConsentState,
	type ConsentStore,
} from "../../domain/consent.js";
import {
	afterMainPaint,
	startErrorTracking,
	stopErrorTracking,
} from "../sentry/index.js";

/** Something that sends data and can be switched on and off. */
export interface Toggle {
	enable(): Promise<void>;
	disable(): Promise<void>;
}

/**
 * Runs `toggle.enable()` while consent is granted and `toggle.disable()` when
 * it is withdrawn, and does nothing at all otherwise. A failing toggle never
 * reaches the caller: observability must not break the application, and if
 * error tracking itself fails there is nowhere to report it.
 */
export function gateByConsent(consent: ConsentStore, toggle: Toggle): void {
	let on = false;

	const apply = (state: ConsentState) => {
		const wanted = state === "granted";
		if (wanted === on) return;
		on = wanted;
		const run = wanted ? toggle.enable() : toggle.disable();
		void run.catch(() => {});
	};

	consent.subscribe(apply);
	apply(consent.get());
}

/** Error tracking: Sentry starts after consent and closes when withdrawn. */
export function errorTrackingToggle(): Toggle {
	return { enable: startErrorTracking, disable: stopErrorTracking };
}

/** Real-user metrics: this is what the lab cannot measure. */
async function startPerformanceMonitoring(app: FirebaseApp): Promise<void> {
	const { getPerformance } = await import("firebase/performance");
	getPerformance(app);
}

/** Starts observability. Never throws: it must not break the application. */
export function startObservability(
	app: FirebaseApp,
	consent: ConsentStore = appConsent(),
): void {
	if (import.meta.env.DEV) return;

	afterMainPaint(() => {
		gateByConsent(consent, errorTrackingToggle());
		void startPerformanceMonitoring(app).catch(() => {});
	});
}
