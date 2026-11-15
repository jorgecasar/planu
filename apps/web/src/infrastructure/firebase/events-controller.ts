import {
	collection,
	type DocumentData,
	type Firestore,
	type FirestoreError,
	onSnapshot,
	type Query,
	query,
	where,
} from "firebase/firestore";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { EventsSnapshot } from "../../application/context.js";
import type { StoredEvent } from "../../lib/types.js";
import { toStoredEvent } from "./event-mapper.js";

/** Shared across every "nothing to show yet" snapshot, so repeated reads
 * during the same `loading`/`error` state return the *same* array reference
 * instead of a fresh empty one each time. `firebase-provider.ts` relies on
 * that to skip republishing a snapshot that hasn't actually changed. */
const NO_EVENTS: StoredEvent[] = [];

/**
 * Subscribes to the signed-in user's events (owned and shared) and exposes
 * them already translated to `StoredEvent`.
 *
 * It is a `ReactiveController` and drives the host's `requestUpdate()` from
 * `onSnapshot` itself (`@lit/task` doesn't fit: this is a stream, not a
 * promise), on top of the query-building and mapping logic that
 * `events-view.ts`'s `willUpdate()`/`toEvent()` used to carry, moved here so
 * a component doesn't have to import `firebase/firestore` to get a live
 * listing. `firebase-provider.ts` is what
 * turns `.snapshot` into `eventsContext`'s value, the same way it already
 * turns `onAuthStateChanged`'s `User` into `SessionUser`.
 *
 * Subscribing needs three things, not two: a `uid`, a `Firestore` instance,
 * and *interest* — someone actually mounted to look at the result. Without
 * that third gate, this would behave like `onAuthStateChanged`: open once at
 * sign-in and never close for the rest of the session, on every route,
 * which is right for the session itself (global, one per app) but wrong
 * here — before this class existed, `events-view.ts` owned its own
 * `CollectionController` directly, so leaving the events route tore the
 * subscription down and coming back opened a fresh one. `setInterested()`
 * is what `firebase-provider.ts` calls, via `eventsInterestContext`, when
 * `events-view.ts` connects and disconnects — see that context's doc
 * comment in `context.ts` for the full reasoning — to recover exactly that
 * behaviour without this class, or `events-view.ts`, having to know about
 * routes or about each other.
 */
export class EventsController implements ReactiveController {
	readonly #host: ReactiveControllerHost;
	#query: Query<DocumentData> | null = null;
	#unsubscribe: (() => void) | undefined;
	#connected = false;
	#data: (DocumentData & { id: string })[] = [];
	#loading = false;
	#error: FirestoreError | null = null;
	#firestore: Firestore | undefined;
	#uid: string | undefined;
	#interested = false;
	#queryKey: string | undefined;

	constructor(host: ReactiveControllerHost) {
		this.#host = host;
		host.addController(this);
	}

	hostConnected(): void {
		this.#connected = true;
		this.#subscribe();
	}

	hostDisconnected(): void {
		this.#connected = false;
		this.#stop();
	}

	#stop(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
	}

	#setQuery(next: Query<DocumentData> | null): void {
		if (next === null && this.#query === null) return;
		this.#query = next;
		this.#subscribe();
	}

	#subscribe(): void {
		this.#stop();
		const watched = this.#query;
		if (!this.#connected || !watched) {
			this.#data = [];
			this.#loading = false;
			this.#host.requestUpdate();
			return;
		}
		this.#loading = true;
		this.#error = null;
		this.#host.requestUpdate();
		this.#unsubscribe = onSnapshot(
			watched,
			(snapshot) => {
				this.#data = snapshot.docs.map((document) => ({
					...document.data(),
					id: document.id,
				}));
				this.#loading = false;
				this.#error = null;
				this.#host.requestUpdate();
			},
			(error) => {
				this.#error = error;
				this.#loading = false;
				this.#host.requestUpdate();
			},
		);
	}

	setFirestore(firestore: Firestore | undefined): void {
		this.#firestore = firestore;
		this.#resubscribe();
	}

	setUid(uid: string | undefined): void {
		this.#uid = uid;
		this.#resubscribe();
	}

	/** See the class doc comment for why this exists as a third, separate gate. */
	setInterested(interested: boolean): void {
		this.#interested = interested;
		this.#resubscribe();
	}

	get #shouldSubscribe(): boolean {
		return Boolean(this.#firestore && this.#uid && this.#interested);
	}

	/**
	 * Rebuilds the query only when what it depends on actually changes. Same
	 * guard `events-view.ts` used to keep on its own `#queryKey`: without it,
	 * every call would tear down and recreate the subscription, which
	 * triggers a snapshot, which triggers another call — a loop.
	 */
	#resubscribe(): void {
		const key = this.#shouldSubscribe ? `${this.#uid}:ready` : "";
		if (key === this.#queryKey) return;
		this.#queryKey = key;

		this.#setQuery(
			this.#shouldSubscribe && this.#firestore && this.#uid
				? query(
						collection(this.#firestore, "events"),
						// By membership rather than ownership, so events other people
						// shared arrive too. The rules deny every other way of
						// querying this collection, filtering by `userId` included.
						// No limit(): search, filters, the calendar, the .ics export
						// and the first-event signal all need every event (#93).
						where("memberIds", "array-contains", this.#uid),
					)
				: null,
		);
	}

	/** Memoizes the mapped list by the raw data's reference, not just its
	 * content: recomputing (and reallocating) on every read would give
	 * `firebase-provider.ts`'s `willUpdate()` a "new" array each time even
	 * when nothing changed, defeating the point of comparing references
	 * before republishing. */
	#lastRawData: (DocumentData & { id: string })[] | undefined;
	#lastEvents: StoredEvent[] = NO_EVENTS;

	get snapshot(): EventsSnapshot {
		if (this.#error) return { status: "error", events: NO_EVENTS };

		// Either Firestore hasn't finished loading yet, the subscription's
		// first snapshot hasn't arrived, or nobody is currently interested
		// (`#shouldSubscribe` is false and the query was torn down). All three
		// read as "loading" to whoever consumes this context — the last one
		// harmlessly so, since nothing consumes `eventsContext` while
		// `events-view.ts` isn't mounted to signal that interest in the
		// first place.
		if (this.#uid && (!this.#shouldSubscribe || this.#loading)) {
			return { status: "loading", events: NO_EVENTS };
		}

		if (this.#data !== this.#lastRawData) {
			this.#lastRawData = this.#data;
			this.#lastEvents = this.#data
				.map(toStoredEvent)
				.filter((event): event is StoredEvent => event !== null);
		}
		return { status: "ready", events: this.#lastEvents };
	}
}
