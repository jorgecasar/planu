/**
 * Observability: errors and real-user performance. Errors are Sentry's and
 * live in `../sentry/`; this file adds Firebase Performance, the only part
 * that needs the Firebase app, and starts both after the first paint.
 *
 * Neither half starts until the visitor has granted consent, with the same
 * gate Analytics uses (`domain/consent.ts`), and withdrawing consent switches
 * both off again. Whether either could instead count as strictly necessary is
 * a legal question for the owner, not a code one.
 */

import type { FirebaseApp } from "firebase/app";
import type { FirebasePerformance } from "firebase/performance";
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

/**
 * Real-user metrics: this is what the lab cannot measure. The SDK is only
 * loaded on `enable()`, and `disable()` stops collection on the instance that
 * `enable()` created, if there is one.
 */
export function performanceToggle(app: FirebaseApp): Toggle {
	let performance: FirebasePerformance | undefined;
	const collect = (on: boolean) => {
		if (!performance) return;
		performance.dataCollectionEnabled = on;
		performance.instrumentationEnabled = on;
	};
	return {
		async enable() {
			const { getPerformance } = await import("firebase/performance");
			performance ??= getPerformance(app);
			collect(true);
		},
		async disable() {
			collect(false);
		},
	};
}

/** Starts observability. Never throws: it must not break the application. */
export function startObservability(
	app: FirebaseApp,
	consent: ConsentStore = appConsent(),
): void {
	if (import.meta.env.DEV) return;

	afterMainPaint(() => {
		gateByConsent(consent, errorTrackingToggle());
		gateByConsent(consent, performanceToggle(app));
	});
}
