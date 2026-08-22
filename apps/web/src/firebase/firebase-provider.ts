import { ContextProvider } from "@lit/context";
import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
	type Auth,
	browserLocalPersistence,
	connectAuthEmulator,
	indexedDBLocalPersistence,
	initializeAuth,
	onAuthStateChanged,
	type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import {
	analyticsContext,
	noopAnalytics,
} from "../application/ports/analytics.js";
import { createAnalyticsAdapter } from "../infrastructure/firebase/analytics-adapter.js";
import {
	FirebaseSessionAdapter,
	toSessionUser,
} from "../infrastructure/firebase/session-adapter.js";
import { DATABASE_ID, EMULATORS, firebaseConfig } from "./config.js";
import {
	appContext,
	firestoreContext,
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
	const auth = initializeAuth(app, {
		persistence: [indexedDBLocalPersistence, browserLocalPersistence],
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

	// `noopAnalytics` de partida: la analítica no depende de la sesión, así
	// que no hay un estado "aún comprobando" que distinguir como en `#user`.
	readonly #analytics = new ContextProvider(this, {
		context: analyticsContext,
		initialValue: noopAnalytics,
	});

	#unsubscribe: (() => void) | undefined;

	constructor() {
		super();
		new ContextProvider(this, {
			context: appContext,
			initialValue: this.#core.app,
		});
		new ContextProvider(this, {
			context: sessionContext,
			initialValue: new FirebaseSessionAdapter(this.#core.auth),
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
				// There is only data to read when there is a session, so this is the
				// exact moment to bring in Firestore and Storage.
				if (user) void this.#provideDataServices(user);
			},
		);
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

			// Publishing the directory entry is what lets other people find this
			// user by email when inviting them. It is not essential to using the
			// application, so its failure does not propagate: denying someone
			// their own data because they could not be listed would be
			// disproportionate.
			const { publishDirectoryEntry } = await import(
				"../sharing/user-directory.js"
			);
			await publishDirectoryEntry(firestore, user).catch(() => {});
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
