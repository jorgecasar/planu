import { expect, test, vi } from "vitest";
import "./app-shell.js";
import { ContextEvent } from "@lit/context";
import type { PlanuApp } from "./app-shell.js";
import type { SessionUser } from "./application/ports/session.js";
import {
	type DeletionGuard,
	deletionGuardContext,
} from "./auth/deletion-guard.js";

/**
 * Sets `user` directly, bypassing `@consume` — there is no
 * `<planu-firebase-provider>` in these tests to answer the context request,
 * so this is how a resolved session gets simulated. Mirrors the pattern
 * already used in `events/event-editor.test.ts` for private fields.
 * `@consume` itself calls `requestUpdate()` when the real context resolves;
 * a direct assignment doesn't, hence doing it here.
 */
function resolveSessionTo(
	el: PlanuApp,
	user: SessionUser | null | undefined,
): void {
	(el as unknown as { user: SessionUser | null | undefined }).user = user;
	el.requestUpdate();
}

/**
 * Mounted with no `<planu-firebase-provider>` ancestor, so `@consume`
 * requests never resolve: `user` stays `undefined`, exactly the "still
 * checking" state this file exists to bound. See
 * docs/spec-ci-e2e-reliability.md for why that state can otherwise last
 * forever against real production traffic.
 */
async function mount(): Promise<PlanuApp> {
	// The router resolves the current location as soon as the element
	// connects. Left at the test runner's own URL, it has no matching route
	// and rejects — harmless, but it fails the suite as an unhandled
	// rejection. `/app/login` is a real route and matches the "checking"
	// state under test regardless: the guard leaves it alone until `user`
	// resolves (see guard.test.ts).
	window.history.pushState({}, "", "/app/login");

	const el = document.createElement("planu-app") as PlanuApp;
	document.body.append(el);
	await el.updateComplete;
	return el;
}

test("mientras se comprueba la sesión se ve el spinner, no un aviso", async () => {
	const el = await mount();

	expect(el.shadowRoot?.querySelector("wa-spinner")).not.toBeNull();
	expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

	el.remove();
});

test("si la comprobación tarda demasiado, el spinner se sustituye por un aviso de recarga", async () => {
	vi.useFakeTimers();
	try {
		const el = await mount();
		expect(el.shadowRoot?.querySelector("wa-spinner")).not.toBeNull();

		vi.advanceTimersByTime(8000);
		await el.updateComplete;

		expect(el.shadowRoot?.querySelector("wa-spinner")).toBeNull();
		const callout = el.shadowRoot?.querySelector("wa-callout");
		expect(callout).not.toBeNull();
		expect(callout?.textContent).toContain("taking longer than expected");

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

test("justo antes del plazo, sigue siendo el spinner", async () => {
	vi.useFakeTimers();
	try {
		const el = await mount();

		vi.advanceTimersByTime(7999);
		await el.updateComplete;

		expect(el.shadowRoot?.querySelector("wa-spinner")).not.toBeNull();
		expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

test("si la sesión se resuelve antes del plazo, el aviso nunca llega a aparecer", async () => {
	vi.useFakeTimers();
	try {
		const el = await mount();

		vi.advanceTimersByTime(300);
		resolveSessionTo(el, null);
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector("wa-spinner")).toBeNull();

		// Well past what would have been the timeout, had it not been
		// cancelled when the session resolved.
		vi.advanceTimersByTime(8000);
		await el.updateComplete;

		expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

test("tras resolverse una vez, una comprobación posterior arma un plazo nuevo, no el viejo", async () => {
	// The real component never re-enters `user === undefined` once resolved
	// (Firebase never re-emits "unknown"), but `#watchSessionCheck()` doesn't
	// know that, and its resolve branch is what a future change could rely
	// on if that ever stopped being true. Regression coverage: confirmed
	// missing by an independent review's mutation testing — deleting the
	// resolve branch's `#cancelSessionCheckTimeout = undefined` left every
	// *other* test in this file green, because the DOM looks identical
	// either way while the session stays resolved. Catching it needs the
	// old and new timers to have different deadlines, which is why the
	// timeline below staggers the transitions instead of resolving
	// immediately at t=0.
	vi.useFakeTimers();
	try {
		const el = await mount(); // t=0: first timer armed, would fire at t=8000

		vi.advanceTimersByTime(500); // t=500
		resolveSessionTo(el, null);
		await el.updateComplete; // real code cancels the t=8000 timer here

		vi.advanceTimersByTime(4000); // t=4500
		resolveSessionTo(el, undefined);
		await el.updateComplete; // real code arms a fresh timer, due at t=12500

		vi.advanceTimersByTime(3500); // t=8000: the *old* timer's deadline
		await el.updateComplete;
		// A correctly-reset timer isn't due for another 4500ms yet.
		expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();

		vi.advanceTimersByTime(4500); // t=12500: the *new* timer's deadline
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector("wa-callout")).not.toBeNull();

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

test("si la sesión llega tarde, tras el aviso, la aplicación se recupera igualmente", async () => {
	// A late `onAuthStateChanged` isn't the same as one that never fires —
	// the timeout is a bound on the wait, not a verdict on the session.
	// Resolves to no session (not signed in) so the assertion isn't
	// entangled with the guard's own redirect-and-navigate flow, which is
	// covered separately in guard.test.ts.
	vi.useFakeTimers();
	try {
		const el = await mount();

		vi.advanceTimersByTime(8000);
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector("wa-callout")).not.toBeNull();

		resolveSessionTo(el, null);
		await el.updateComplete;

		expect(el.shadowRoot?.querySelector("wa-callout")).toBeNull();
		expect(el.shadowRoot?.querySelector("planu-login-view")).not.toBeNull();

		el.remove();
	} finally {
		vi.useRealTimers();
	}
});

const someone: SessionUser = {
	uid: "u1",
	email: "a@example.com",
	displayName: null,
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

/** Signed in on the profile, with the shell's guard in hand. */
async function onProfileWithGuard() {
	window.history.pushState({}, "", "/app/profile");
	const el = document.createElement("planu-app") as PlanuApp;
	document.body.append(el);
	resolveSessionTo(el, someone);
	const view = await vi.waitFor(() => {
		const found = el.shadowRoot?.querySelector("planu-profile-view");
		if (!found) throw new Error("no profile view yet");
		return found;
	});
	// Asked from the view, as the real consumer does: a provider ignores
	// requests coming from its own host.
	let guard: DeletionGuard | undefined;
	view.dispatchEvent(
		new ContextEvent(deletionGuardContext, view, (value) => {
			guard = value;
		}),
	);
	if (!guard) throw new Error("the shell provides no deletion guard");
	return { el, guard };
}

function loginStatus(el: PlanuApp): string {
	const login = el.shadowRoot?.querySelector("planu-login-view");
	const region = login?.shadowRoot?.querySelector('[role="status"]');
	return region?.textContent ?? "";
}

test("si la sesión acaba durante el borrado, se espera a que termine para ir al acceso con el aviso", async () => {
	const { el, guard } = await onProfileWithGuard();
	guard.begin();

	resolveSessionTo(el, null);
	await el.updateComplete;
	expect(window.location.pathname).toBe("/app/profile");
	expect(el.shadowRoot?.querySelector("planu-profile-view")).not.toBeNull();

	guard.end("succeeded");
	await vi.waitFor(() => {
		expect(loginStatus(el)).toContain("Your account has been deleted.");
	});
	expect(window.location.pathname).toBe("/app/login");
	el.remove();
});

test("atrás, o un cambio de cuenta, durante el borrado no desmonta el perfil", async () => {
	// Preloaded so the route would be entered at once if nothing refused it.
	await import("./events/events-view.js");
	const { el, guard } = await onProfileWithGuard();
	const view = el.shadowRoot?.querySelector("planu-profile-view");
	guard.begin();

	// Back twice after signing in reaches the login entry: refused too.
	for (const path of ["/app", "/app/login"]) {
		window.history.pushState({}, "", path);
		window.dispatchEvent(new PopStateEvent("popstate"));
		resolveSessionTo(el, { ...someone, uid: "u2" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		await el.updateComplete;

		expect(window.location.pathname).toBe("/app/profile");
		expect(view?.isConnected).toBe(true);
	}
	guard.end("failed");
	el.remove();
});

test("si el borrado falla porque se cerró la sesión, el acceso pide repetirlo", async () => {
	const { el, guard } = await onProfileWithGuard();
	guard.begin();
	resolveSessionTo(el, null);
	await el.updateComplete;

	guard.end("failed");

	await vi.waitFor(() => {
		expect(loginStatus(el)).toContain("delete it once more");
	});
	el.remove();
});

test("desmontar antes del plazo cancela el temporizador", async () => {
	// Regression coverage for `disconnectedCallback`'s cleanup — confirmed
	// missing by an independent review's mutation testing. Asserting that
	// advancing time afterward "doesn't throw" isn't enough: a stray
	// `setTimeout` firing against a detached element doesn't throw either,
	// it just silently flips state nobody will ever render. Reading the
	// field directly is what actually distinguishes "cancelled" from
	// "fired into the void".
	vi.useFakeTimers();
	try {
		const el = await mount();
		el.remove();

		vi.advanceTimersByTime(8000);

		expect(
			(el as unknown as { sessionCheckTimedOut: boolean }).sessionCheckTimedOut,
		).toBe(false);
	} finally {
		vi.useRealTimers();
	}
});
