/**
 * Observability: errors and real-user performance.
 *
 * Everything loads **after the first paint and deferred**. Neither of the
 * two helps the user see their screen sooner, and adding them to startup
 * would undo a good part of the performance work: the initial JavaScript
 * went from 266 kB compressed down to about 124.
 *
 * None of this runs in development: it would only clutter the project with
 * emulator noise.
 */

import type { FirebaseApp } from "firebase/app";
import { flushStartupErrors } from "../domain/startup-buffer.js";

/** Waits for the browser to be idle, or for a fixed delay if it isn't supported. */
function whenIdle(task: () => void): void {
	const idle = (
		globalThis as { requestIdleCallback?: (cb: () => void) => number }
	).requestIdleCallback;

	if (idle) idle(task);
	else setTimeout(task, 3000);
}

/**
 * Waits for the main content to paint, and only then for idle time.
 *
 * `requestIdleCallback` on its own does **not** wait for paint: it fires on
 * the first gap of inactivity, and that gap arrives earlier. Measured in
 * production, the Sentry and Firebase Performance chunks were downloading
 * between 1142 and 1251 ms, with LCP at 1481 ms: they were competing for
 * bandwidth and main thread right in the window that tolerates it worst.
 *
 * The double `requestAnimationFrame` fixes that: the second one runs after
 * the compositor has painted the frame that the first one queued.
 */
function afterMainPaint(task: () => void): void {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			whenIdle(task);
		});
	});
}

/**
 * Error tracking.
 *
 * Without a DSN it does nothing: this way the repo works without a Sentry
 * account, and whoever deploys decides whether they want to send errors.
 */
async function startErrorTracking(): Promise<void> {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	// Destructured and not as a namespace: with `import * as Sentry`, Rollup
	// keeps the whole module and Session Replay travelled along anyway.
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
		// `sendDefaultPii` is not declared: its default is already `false` and
		// the option is deprecated —it disappears in v11 of the SDK—. The
		// events come from a private planner and there is no reason to send
		// headers or IP addresses, so the default is exactly what we want.
		release: import.meta.env.VITE_RELEASE,
		// Errors only. Performance traces come from Firebase Performance, and
		// enabling them here would duplicate cost and weight.
		tracesSampleRate: 0,
		// Explicit and not the defaults: without this list, `init` references
		// the full set and Rollup cannot drop Session Replay or the Feedback
		// widget. They were in the bundle —455 KiB raw, with 83% unused— just
		// to never run.
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

/**
 * How one attempt at a background write went.
 *
 * `success` and `skipped` are not errors — `skipped` is for a write that was
 * never attempted at all, e.g. `claimPendingInvitesByEmail` called with no
 * candidates to check, which is today's documented state at both of its real
 * call sites (see its own doc comment in `sharing/user-directory.ts`).
 * `permission-denied` is Firestore's rule engine saying no; `failure` is
 * everything else — offline, a timeout, anything unclassified.
 */
export type BackgroundWriteOutcome =
	| "success"
	| "skipped"
	| "permission-denied"
	| "failure";

/**
 * Records one attempt at a write whose caller already swallows its own
 * failure — see `publishDirectoryEntry` and `claimPendingInvitesByEmail`
 * in `sharing/user-directory.ts`, both called with a `.catch(() => {})` (or,
 * for the one call site that lacks it, an outer `try`/`catch` that discards
 * it the same way) at every real call site today. Neither caller's behaviour
 * changes because of this: it never throws, and nothing here is awaited by
 * the write it describes.
 *
 * This is what turns "reloading republishes the directory reliably" from a
 * guess into something with evidence — see this project's own
 * `SPEC-verificacion-email-invitaciones.md`.
 *
 * `success` and `skipped` become a breadcrumb: context attached to whatever
 * error Sentry captures next, not an event of their own — one per sign-in
 * would be noise with a bill attached. `permission-denied` and `failure`
 * become a tagged `captureException`, queryable by `operation` and `outcome`
 * later.
 */
export function recordBackgroundWrite(
	operation: string,
	outcome: BackgroundWriteOutcome,
	detail?: unknown,
): void {
	if (import.meta.env.DEV) return;

	afterMainPaint(() => {
		void reportBackgroundWrite(operation, outcome, detail).catch(() => {
			// Same rule as everything else in this file: observability must
			// never become the reason something else breaks.
		});
	});
}

async function reportBackgroundWrite(
	operation: string,
	outcome: BackgroundWriteOutcome,
	detail: unknown,
): Promise<void> {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	const { addBreadcrumb, captureException } = await import("@sentry/browser");

	if (outcome === "success" || outcome === "skipped") {
		addBreadcrumb({
			category: "background-write",
			message:
				typeof detail === "string" ? `${operation}: ${detail}` : operation,
			data: { outcome },
			level: "info",
		});
		return;
	}

	captureException(
		detail instanceof Error ? detail : new Error(`${operation}: ${outcome}`),
		{ tags: { operation, outcome } },
	);
}
