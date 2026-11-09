import { ContextProvider } from "@lit/context";
import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
	type Auth,
	browserLocalPersistence,
	connectAuthEmulator,
	initializeAuth,
	onAuthStateChanged,
	type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { accountDataContext } from "../application/ports/account-data.js";
import { aiModelContext } from "../application/ports/ai-model.js";
import {
	analyticsContext,
	noopAnalytics,
} from "../application/ports/analytics.js";
import { sharingContext } from "../application/ports/sharing.js";
import { createAccountDataAdapter } from "../infrastructure/firebase/account-data-adapter.js";
import { createAiModelAdapter } from "../infrastructure/firebase/ai-model-adapter.js";
import { createAnalyticsAdapter } from "../infrastructure/firebase/analytics-adapter.js";
import { FirebaseEventRepository } from "../infrastructure/firebase/event-repository.js";
import { EventsController } from "../infrastructure/firebase/events-controller.js";
import { FirebaseImageStore } from "../infrastructure/firebase/image-store.js";
import {
	FirebaseSessionAdapter,
	toSessionUser,
} from "../infrastructure/firebase/session-adapter.js";
import { createSharingAdapter } from "../infrastructure/firebase/sharing-adapter.js";
import { DATABASE_ID, EMULATORS, firebaseConfig } from "./config.js";
import {
	appContext,
	type EventsSnapshot,
	eventRepositoryContext,
	eventsContext,
	eventsInterestContext,
	firestoreContext,
	imageStoreContext,
	sessionContext,
	storageContext,
	userContext,
} from "./context.js";

export interface CoreServices {
	app: FirebaseApp;
	auth: Auth;
}

export interface DataServices {
	firestore: Firestore;
	storage: FirebaseStorage;
}

let core: CoreServices | undefined;
let data: Promise<DataServices> | undefined;

/**
 * The bare minimum to decide where the user goes: the app and Auth.
 *
 * Firestore and Storage are left out on purpose. They used to be loaded here
 * and entered the startup of every session, including those that only see
 * the login: they were the bulk of the 180 KiB of unused JavaScript that
 * Lighthouse measured.
 */
export function initializeFirebase(): CoreServices {
	if (core) return core;

	const app = getApps()[0] ?? initializeApp(firebaseConfig);

	// `initializeAuth` and not `getAuth`: the latter installs the
	// `browserPopupRedirectResolver` by default, which checks for a pending
	// redirect when Auth starts up. That check downloaded gapi and the
	// authentication iframe —137 KiB from three third-party origins— on
	// **every** visit, even if nobody pressed the Google button. It was the
	// longest dependency chain on the page: 4.7 s. The resolver is now passed
	// in `signInWithPopup` itself, so only whoever uses that sign-in pays for it.
	//
	// `persistence` is `browserLocalPersistence` only, **not**
	// `[indexedDBLocalPersistence, browserLocalPersistence]` as this line first
	// shipped. That combination is exactly what made `/app` stick on "Checking
	// your session" with no error and no network call — a silent hang inside
	// the SDK's own persistence resolution, documented in
	// `docs/spec-ci-e2e-reliability.md` as an unconfirmed hypothesis at the
	// time (firebase-js-sdk#8626, #8545, #5874) and confirmed here with a
	// controlled A/B: same build, same throttled network, only this line
	// changed — 0/25 hangs with `browserLocalPersistence` alone versus 9/25
	// with IndexedDB in the mix. `browserLocalPersistence` still avoids
	// `getAuth`'s resolver, so the LCP win stays; only the fragile backend goes.
	const auth = initializeAuth(app, {
		persistence: browserLocalPersistence,
	});

	if (import.meta.env.DEV) {
		connectAuthEmulator(auth, `http://localhost:${EMULATORS.auth}`, {
			disableWarnings: true,
		});
	}

	core = { app, auth };
	return core;
}

/**
 * Loads Firestore and Storage on demand, only once.
 *
 * `connectXEmulator` only allows one call, and before any operation, which is
 * why the promise is memoized instead of the result.
 */
export function loadDataServices(app: FirebaseApp): Promise<DataServices> {
	data ??= (async () => {
		// A rejection is memoized just like a success: without clearing the
		// reference, a transient failure of the dynamic import would leave the
		// application without data until the whole page is reloaded.
		const [{ getFirestore, connectFirestoreEmulator }, storageModule] =
			await Promise.all([
				import("firebase/firestore"),
				import("firebase/storage"),
			]);

		// This project's database is not the `(default)` one.
		const firestore = getFirestore(app, DATABASE_ID);
		const storage = storageModule.getStorage(app);

		if (import.meta.env.DEV) {
			connectFirestoreEmulator(firestore, "localhost", EMULATORS.firestore);
			storageModule.connectStorageEmulator(
				storage,
				"localhost",
				EMULATORS.storage,
			);
		}

		return { firestore, storage };
	})().catch((cause: unknown) => {
		data = undefined;
		throw cause;
	});

	return data;
}

/**
 * Publishes the Firebase services and the current session through context.
 * Wraps the rest of the application.
 */
@customElement("planu-firebase-provider")
export class PlanuFirebaseProvider extends LitElement {
	readonly #core = initializeFirebase();

	readonly #user = new ContextProvider(this, {
		context: userContext,
		// undefined = still checking. Not the same as "no session".
		initialValue: undefined,
	});

	readonly #firestore = new ContextProvider(this, {
		context: firestoreContext,
	});

	readonly #storage = new ContextProvider(this, { context: storageContext });

	// `AccountDataPort`, built once both Firestore and Storage are ready —
	// see `#provideDataServices()`. This is the one place allowed to import
	// `infrastructure/firebase/account-data-adapter.js`, so components like
	// `profile-view.ts` never construct it themselves.
	readonly #accountData = new ContextProvider(this, {
		context: accountDataContext,
	});

	// `SharingPort`, built once both Firestore is ready — see
	// `#provideDataServices()`. This is the one place allowed to import
	// `infrastructure/firebase/sharing-adapter.js`, so components like
	// `share-dialog.ts` and `profile-view.ts` never construct it themselves.
	readonly #sharing = new ContextProvider(this, { context: sharingContext });

	// `noopAnalytics` up front: analytics doesn't depend on the session, so
	// there's no "still checking" state to distinguish, unlike `#user`.
	readonly #analytics = new ContextProvider(this, {
		context: analyticsContext,
		initialValue: noopAnalytics,
	});

	readonly #eventRepository = new ContextProvider(this, {
		context: eventRepositoryContext,
	});

	readonly #imageStore = new ContextProvider(this, {
		context: imageStoreContext,
	});

	// The live listing, kept apart from `#eventRepository`: that port is
	// per-operation on purpose (see its own doc comment), and observing a
	// collection is this provider's job, same as `onAuthStateChanged` below.
	// `EventsController` owns the query and the `Timestamp`→`Date` mapping;
	// this class only turns its `.snapshot` into `eventsContext`'s value, and
	// — unlike every other context here — also has to be told when that
	// subscription is actually wanted; see `eventsContext`'s own doc comment
	// in `context.ts` for why, and `#eventsInterest` below for how.
	readonly #eventsController = new EventsController(this);
	readonly #events = new ContextProvider(this, { context: eventsContext });
	#lastPublishedEvents: EventsSnapshot | undefined;

	#unsubscribe: (() => void) | undefined;

	constructor() {
		super();
		new ContextProvider(this, {
			context: appContext,
			initialValue: this.#core.app,
		});
		new ContextProvider(this, {
			context: aiModelContext,
			initialValue: createAiModelAdapter(this.#core.app),
		});
		new ContextProvider(this, {
			context: sessionContext,
			initialValue: new FirebaseSessionAdapter(this.#core.auth),
		});
		// A stable function, not a DOM event: `events-view.ts` calls this from
		// its own `disconnectedCallback()`, which runs *after* it has already
		// been detached from the tree — a bubbling event dispatched at that
		// point would have no parent left to bubble through. Provided once, as
		// an `initialValue`, since the function itself never changes.
		new ContextProvider(this, {
			context: eventsInterestContext,
			initialValue: (interested: boolean) => {
				this.#eventsController.setInterested(interested);
				this.#publishEvents();
			},
		});
	}

	override connectedCallback(): void {
		super.connectedCallback();
		// No espera a que haya sesión: T31 mide activación desde la visita, no
		// sólo tras registrarse. `isSupported()` es asíncrono —de ahí la
		// promesa— y nunca lanza; ver createAnalyticsAdapter.
		void createAnalyticsAdapter(this.#core.app).then((adapter) => {
			this.#analytics.setValue(adapter);
		});
		this.#unsubscribe = onAuthStateChanged(
			this.#core.auth,
			(user: User | null) => {
				// The context exposes the domain type: whoever consumes it shouldn't
				// need to know this comes from Firebase.
				this.#user.setValue(user ? toSessionUser(user) : null);
				// The uid alone is enough to decide the listing's state (see
				// `EventsController.snapshot`): with no Firestore yet, it already
				// distinguishes "loading" from "logged out and nothing to show".
				this.#eventsController.setUid(user?.uid);
				this.#publishEvents();
				// There is only data to read when there is a session, so this is the
				// exact moment to bring in Firestore and Storage.
				if (user) void this.#provideDataServices(user);
			},
		);
	}

	/**
	 * Pushes `EventsController`'s current snapshot into `eventsContext`, but
	 * only when it actually changed: `EventsController.snapshot` memoizes its
	 * own `events` array (see there), so comparing by reference here is
	 * enough to skip a republish — and the render it would otherwise force on
	 * every consumer of `eventsContext` — triggered by something unrelated,
	 * such as `willUpdate()` running because `createAnalyticsAdapter()`'s
	 * promise resolved.
	 *
	 * Called explicitly wherever this provider changes something the snapshot
	 * depends on (`setUid`, `setFirestore`, and `eventsInterestContext`'s
	 * callback above), and again from `willUpdate()`: `CollectionController`
	 * calls `requestUpdate()` on this element whenever `onSnapshot` delivers
	 * new data or an error, and that is the only signal for those two
	 * asynchronous cases.
	 */
	#publishEvents(): void {
		const snapshot = this.#eventsController.snapshot;
		const last = this.#lastPublishedEvents;
		if (
			last &&
			last.status === snapshot.status &&
			last.events === snapshot.events
		) {
			return;
		}
		this.#lastPublishedEvents = snapshot;
		this.#events.setValue(snapshot);
	}

	override willUpdate(): void {
		this.#publishEvents();
	}

	/**
	 * Without this `catch` the failure was invisible: an unhandled rejected
	 * promise, the contexts never got filled in, and the view kept waiting for
	 * data that was never going to arrive, without saying anything.
	 */
	async #provideDataServices(user: User): Promise<void> {
		try {
			const { firestore, storage } = await loadDataServices(this.#core.app);
			this.#firestore.setValue(firestore);
			this.#storage.setValue(storage);
			this.#eventRepository.setValue(new FirebaseEventRepository(firestore));
			this.#imageStore.setValue(new FirebaseImageStore(storage));
			this.#accountData.setValue(createAccountDataAdapter(firestore, storage));
			const sharing = createSharingAdapter(firestore);
			this.#sharing.setValue(sharing);
			this.#eventsController.setFirestore(firestore);
			this.#publishEvents();

			// Publishing the directory entry is what lets other people find this
			// user by email when inviting them. It is not essential to using the
			// application, so its failure does not propagate: denying someone
			// their own data because they could not be listed would be
			// disproportionate.
			//
			// Converted explicitly, not passed through as `User`: the domain type
			// carries fields Firebase's own doesn't — `provider`, for T32 — and
			// the two happened to structurally match well enough that TypeScript
			// never caught the shortcut until this one didn't.
			const sessionUser = toSessionUser(user);
			await sharing.publishDirectoryEntry(sessionUser).catch(() => {});
		} catch {
			this.dispatchEvent(
				new CustomEvent("planu-data-services-failed", {
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
	}

	override render() {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-firebase-provider": PlanuFirebaseProvider;
	}
}
