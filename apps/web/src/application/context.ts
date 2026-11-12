import { createContext } from "@lit/context";
import type { StoredEvent } from "../lib/types.js";
import type { EventRepositoryPort } from "./ports/event-repository.js";
import type { ImageStorePort } from "./ports/image-store.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

// What the UI consumes and the composition root
// (`infrastructure/firebase/firebase-provider.ts`) publishes. It lives in
// `application/` because components may depend on it and must not depend on
// `infrastructure/`, the same place the port contexts already live
// (`accountDataContext`, `sharingContext`…). No provider types here.

/**
 * The session port, not `Auth`: whoever consumes this context doesn't know
 * Firebase exists. See `application/ports/session.ts`.
 */
export const sessionContext = createContext<SessionPort | undefined>(
	Symbol("planu-session"),
);

/**
 * The event repository port, not `Firestore`: what lets `event-editor.ts`
 * stop importing `firebase/firestore` (T48 of the hours-in-events spec).
 */
export const eventRepositoryContext = createContext<
	EventRepositoryPort | undefined
>(Symbol("planu-event-repository"));

/** The image store port, not `FirebaseStorage`. Same reason. */
export const imageStoreContext = createContext<ImageStorePort | undefined>(
	Symbol("planu-image-store"),
);

/**
 * `eventsContext`'s payload. `"loading"` covers two situations
 * `events-view.ts` used to check separately — Firestore still travelling
 * through its dynamic import, and the subscription's first snapshot not
 * having arrived yet — because a component consuming this context has no
 * way to tell them apart anyway, and didn't need to. `"error"` is what an
 * `onSnapshot` failure becomes once it crosses this boundary: nobody
 * downstream needs a `FirestoreError`.
 */
export type EventsStatus = "loading" | "ready" | "error";

export interface EventsSnapshot {
	status: EventsStatus;
	/** Already translated: `Timestamp` becomes `Date` before this exists. */
	events: StoredEvent[];
}

/**
 * The signed-in user's events — owned and shared — kept live. Not a port:
 * `EventRepositoryPort` stays per-operation on purpose (see its own doc
 * comment), and observing a live collection is the publisher's job, same
 * reasoning as `onAuthStateChanged` being absent from `SessionPort`. See
 * `infrastructure/firebase/events-controller.ts`, which does the observing,
 * and `firebase-provider.ts`, which publishes it.
 *
 * `undefined` until the first snapshot is computed, same idea as
 * `userContext`'s "still checking": a consumer should treat it the same as
 * `"loading"`.
 *
 * **Deliberately not always-on the way `sessionContext` is.** The session is
 * one global thing the whole app cares about regardless of route, so opening
 * its `onAuthStateChanged` listener once at startup and never closing it is
 * right. The events listing isn't: before it moved behind this context,
 * `events-view.ts` owned its own `CollectionController` directly, so the
 * `onSnapshot` subscription only existed while that view was mounted —
 * leaving the events route for `/profile` closed it, coming back opened a
 * fresh one. Publishing the snapshot from `firebase-provider.ts` (which
 * never unmounts) could easily have dropped that and left the subscription
 * open on every route for the rest of the session — background bandwidth
 * and a Firestore connection nobody asked to keep, on routes with no
 * listing in sight. `eventsInterestContext` below is what recovers the
 * original, route-scoped lifetime without pulling `Firestore` back into
 * `events-view.ts`.
 */
export const eventsContext = createContext<EventsSnapshot | undefined>(
	Symbol("planu-events"),
);

/**
 * Tells whoever publishes `eventsContext` whether its subscription is
 * currently wanted. `events-view.ts` calls it with `true` from
 * `connectedCallback()` and `false` from `disconnectedCallback()` — see the
 * doc comment on `eventsContext` above for why that matters.
 *
 * A function through context, not a bubbling DOM event: `disconnectedCallback()`
 * runs *after* the element has already been detached from the tree, with no
 * parent left to bubble an event through. A plain function reference has no
 * such timing problem — it works identically whether the caller is
 * connected or not — and `@lit/context` hands it down once, as an
 * `initialValue`, since it never changes for the life of the session.
 */
export const eventsInterestContext = createContext<
	((interested: boolean) => void) | undefined
>(Symbol("planu-events-interest"));

/**
 * Current session. The three states matter and must not be collapsed:
 * `undefined` = still checking, `null` = no session, `SessionUser` =
 * authenticated. Confusing "checking" with "no session" causes a flicker to
 * the login.
 *
 * Exposes the domain type, not Firebase's `User`: that's what lets
 * `app-shell.ts` and `profile-view.ts` stop importing `firebase/auth`.
 */
export const userContext = createContext<SessionUser | null | undefined>(
	Symbol("planu-user"),
);
