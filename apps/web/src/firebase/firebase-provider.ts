import { ContextProvider } from "@lit/context";
import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
	type Auth,
	connectAuthEmulator,
	getAuth,
	onAuthStateChanged,
	type User,
} from "firebase/auth";
import {
	connectFirestoreEmulator,
	type Firestore,
	getFirestore,
} from "firebase/firestore";
import {
	connectStorageEmulator,
	type FirebaseStorage,
	getStorage,
} from "firebase/storage";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { DATABASE_ID, EMULATORS, firebaseConfig } from "./config.js";
import {
	appContext,
	authContext,
	firestoreContext,
	storageContext,
	userContext,
} from "./context.js";

export interface FirebaseServices {
	app: FirebaseApp;
	auth: Auth;
	firestore: Firestore;
	storage: FirebaseStorage;
}

let services: FirebaseServices | undefined;

/**
 * Inicializa Firebase una sola vez por carga de página.
 *
 * En desarrollo conecta los emuladores. `connectXEmulator` sólo puede llamarse
 * antes de la primera operación y una única vez, de ahí el memoizado.
 */
export function initializeFirebase(): FirebaseServices {
	if (services) return services;

	const app = getApps()[0] ?? initializeApp(firebaseConfig);
	const auth = getAuth(app);
	// La base de este proyecto no es la `(default)`.
	const firestore = getFirestore(app, DATABASE_ID);
	const storage = getStorage(app);

	if (import.meta.env.DEV) {
		connectAuthEmulator(auth, `http://localhost:${EMULATORS.auth}`, {
			disableWarnings: true,
		});
		connectFirestoreEmulator(firestore, "localhost", EMULATORS.firestore);
		connectStorageEmulator(storage, "localhost", EMULATORS.storage);
	}

	services = { app, auth, firestore, storage };
	return services;
}

/**
 * Publica los servicios de Firebase y la sesión actual por contexto.
 * Envuelve al resto de la aplicación.
 */
@customElement("planu-firebase-provider")
export class PlanuFirebaseProvider extends LitElement {
	readonly #services = initializeFirebase();

	readonly #user = new ContextProvider(this, {
		context: userContext,
		// undefined = todavía comprobando. No es lo mismo que "sin sesión".
		initialValue: undefined,
	});

	#unsubscribe: (() => void) | undefined;

	constructor() {
		super();
		new ContextProvider(this, {
			context: appContext,
			initialValue: this.#services.app,
		});
		new ContextProvider(this, {
			context: authContext,
			initialValue: this.#services.auth,
		});
		new ContextProvider(this, {
			context: firestoreContext,
			initialValue: this.#services.firestore,
		});
		new ContextProvider(this, {
			context: storageContext,
			initialValue: this.#services.storage,
		});
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#unsubscribe = onAuthStateChanged(
			this.#services.auth,
			(user: User | null) => {
				this.#user.setValue(user);
			},
		);
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
