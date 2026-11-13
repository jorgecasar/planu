import { expect, test, vi } from "vitest";
import { DELETION_GUARD_CAP_MS, DeletionGuard } from "./deletion-guard.js";

function fakeWindow() {
	return Object.assign(new EventTarget(), {
		location: { pathname: "/app/profile" },
		history: { pushState: vi.fn() },
	});
}

function unloadIsBlocked(win: EventTarget): boolean {
	const event = new Event("beforeunload", { cancelable: true });
	win.dispatchEvent(event);
	return event.defaultPrevented;
}

test("el aviso al cerrar la pestaña sólo está armado mientras se borra", () => {
	const win = fakeWindow();
	const guard = new DeletionGuard(win, () => true);
	expect(unloadIsBlocked(win)).toBe(false);

	expect(guard.begin()).toBe(true);
	expect(guard.running).toBe(true);
	expect(unloadIsBlocked(win)).toBe(true);

	guard.end("succeeded");
	expect(guard.running).toBe(false);
	expect(unloadIsBlocked(win)).toBe(false);
	expect(guard.takeNotice()).toBe("account-deleted");
	expect(guard.takeNotice()).toBeUndefined();
});

test("un fallo con sesión también lo suelta, sin aviso para el acceso", () => {
	const win = fakeWindow();
	const guard = new DeletionGuard(win, () => true);

	guard.begin();
	guard.end("failed");

	expect(guard.running).toBe(false);
	expect(unloadIsBlocked(win)).toBe(false);
	expect(guard.takeNotice()).toBeUndefined();
});

test("atrás durante el borrado devuelve la URL a la ruta del borrado", () => {
	const win = fakeWindow();
	const guard = new DeletionGuard(win, () => true);

	guard.begin();
	win.location.pathname = "/app";
	win.dispatchEvent(new Event("popstate"));
	expect(win.history.pushState).toHaveBeenCalledWith({}, "", "/app/profile");

	guard.end("succeeded");
	win.dispatchEvent(new Event("popstate"));
	expect(win.history.pushState).toHaveBeenCalledOnce();
});

test("pasado el tope se suelta solo; uno terminado a tiempo lo cancela", () => {
	vi.useFakeTimers();
	try {
		const win = fakeWindow();
		const guard = new DeletionGuard(win, () => false);
		guard.begin();
		vi.advanceTimersByTime(DELETION_GUARD_CAP_MS / 2);
		guard.end("succeeded");

		// A stale first cap would fire halfway through this one.
		guard.begin();
		vi.advanceTimersByTime(DELETION_GUARD_CAP_MS - 1);
		expect(guard.running).toBe(true);
		vi.advanceTimersByTime(1);
		expect(guard.running).toBe(false);
		expect(unloadIsBlocked(win)).toBe(false);
		expect(guard.takeNotice()).toBe("deletion-interrupted");
		guard.end("failed"); // the stuck deletion failing after the cap
		expect(guard.takeNotice()).toBeUndefined();
		guard.end("succeeded"); // or succeeding late: that notice still counts
		expect(guard.takeNotice()).toBe("account-deleted");
	} finally {
		vi.useRealTimers();
	}
});

test("avisa al empezar y al terminar; un segundo begin armado se rechaza", () => {
	const guard = new DeletionGuard(fakeWindow(), () => true);
	const seen: boolean[] = [];
	const unsubscribe = guard.subscribe(() => seen.push(guard.running));

	guard.begin();
	expect(guard.begin()).toBe(false);
	guard.end("succeeded");
	unsubscribe();
	guard.begin();

	expect(seen).toEqual([true, false]);
});
