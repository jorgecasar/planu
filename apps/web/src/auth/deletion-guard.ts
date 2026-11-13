import { createContext } from "@lit/context";
import type { LoginNotice } from "./login-notice.js";

/** The slice of `window` the guard touches, so tests can hand it a fake. */
export type GuardedWindow = Pick<
	Window,
	"addEventListener" | "removeEventListener"
> & {
	location: Pick<Location, "pathname">;
	history: Pick<History, "pushState">;
};

/**
 * Past this the guard lets go on its own: offline, Firestore deletes never
 * settle and would trap the tab. Far beyond any real deletion.
 */
export const DELETION_GUARD_CAP_MS = 5 * 60_000;

/**
 * Keeps an account deletion from being lost silently (#154). Owned by the
 * shell, above the route, so it outlives the profile view. While `running`
 * (confirmation through any reauthentication), closing the tab asks first,
 * Back is undone and the shell holds its routes.
 */
export class DeletionGuard {
	readonly #window: GuardedWindow;
	readonly #hasSession: () => boolean;
	readonly #listeners = new Set<() => void>();
	#running = false;
	#lockedPath = "";
	#notice: LoginNotice | undefined;
	#cap: ReturnType<typeof setTimeout> | undefined;

	constructor(window: GuardedWindow, hasSession: () => boolean) {
		this.#window = window;
		this.#hasSession = hasSession;
	}

	get running(): boolean {
		return this.#running;
	}

	/** Arms the guard. Returns `false`, changing nothing, if already armed. */
	begin(): boolean {
		if (this.#running) return false;
		this.#running = true;
		this.#notice = undefined;
		this.#lockedPath = this.#window.location.pathname;
		this.#window.addEventListener("beforeunload", this.#onBeforeUnload);
		this.#window.addEventListener("popstate", this.#onPopState);
		this.#cap = setTimeout(() => this.end("failed"), DELETION_GUARD_CAP_MS);
		this.#notify();
		return true;
	}

	/**
	 * Releases the guard and records the notice. A failure with the session
	 * still there is the profile view's to report; without one, nobody is
	 * left to. Once released (by the cap), a late failure changes nothing and
	 * a late success still leaves its notice.
	 */
	end(outcome: "succeeded" | "failed"): void {
		const failed = this.#hasSession() ? undefined : "deletion-interrupted";
		if (outcome === "succeeded") this.#notice = "account-deleted";
		else if (this.#running) this.#notice = failed;
		clearTimeout(this.#cap);
		this.#running = false;
		this.#window.removeEventListener("beforeunload", this.#onBeforeUnload);
		this.#window.removeEventListener("popstate", this.#onPopState);
		this.#notify();
	}

	/** The notice left by the last deletion, handed out once. */
	takeNotice(): LoginNotice | undefined {
		const notice = this.#notice;
		this.#notice = undefined;
		return notice;
	}

	/** Called whenever `running` changes. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}

	readonly #onBeforeUnload = (event: Event): void => {
		event.preventDefault();
	};

	// Back already changed the URL by the time this runs. The routes refuse to
	// enter while `running`, so the view stays; this puts the URL back with it.
	readonly #onPopState = (): void => {
		this.#window.history.pushState({}, "", this.#lockedPath);
	};
}

export const deletionGuardContext = createContext<DeletionGuard | undefined>(
	Symbol("planu-deletion-guard"),
);
