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

function codeOf(error: unknown): string {
	const { code } = Object(error) as { code?: unknown };
	return code === undefined ? "unknown" : String(code);
}

/**
 * A write whose callers swallow failure (T65): success is a breadcrumb, a
 * failure a synthetic exception tagged `operation`, `outcome` and `code`.
 */
export function recordBackgroundWrite(
	operation: string,
	outcome: "success" | "permission-denied" | "failure",
	error?: unknown,
): void {
	if (import.meta.env.DEV || !import.meta.env.VITE_SENTRY_DSN) return;

	afterMainPaint(() => {
		void import("@sentry/browser")
			.then(({ addBreadcrumb, captureException }) => {
				if (outcome === "success") {
					addBreadcrumb({
						category: "background-write",
						message: operation,
						level: "info",
					});
				} else {
					// Never the original: Firestore messages can embed the document
					// path, `userDirectory/<email hash>` or `userProfiles/<uid>`.
					captureException(new Error(`${operation}: ${outcome}`), {
						tags: { operation, outcome, code: codeOf(error) },
					});
				}
			})
			.catch(() => {});
	});
}
