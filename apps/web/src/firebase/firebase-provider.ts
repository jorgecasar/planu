import { ContextProvider } from "@lit/context";
import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
	type Auth,
	connectAuthEmulator,
	getAuth,
	onAuthStateChanged,
	type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
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
 * Lo imprescindible para decidir a dónde va el usuario: la app y Auth.
 *
 * Firestore y Storage quedan fuera a propósito. Se cargaban aquí y entraban en
 * el arranque de todas las sesiones, incluidas las que sólo ven el login: eran
 * la mayor parte de los 180 KiB de JavaScript sin usar que midió Lighthouse.
 */
export function initializeFirebase(): CoreServices {
	if (core) return core;

	const app = getApps()[0] ?? initializeApp(firebaseConfig);
	const auth = getAuth(app);

	if (import.meta.env.DEV) {
		connectAuthEmulator(auth, `http://localhost:${EMULATORS.auth}`, {
			disableWarnings: true,
		});
	}

	core = { app, auth };
	return core;
}

/**
 * Carga Firestore y Storage bajo demanda, una sola vez.
 *
 * `connectXEmulator` sólo admite una llamada y antes de cualquier operación,
 * de ahí que la promesa se memoice en lugar del resultado.
 */
export function loadDataServices(app: FirebaseApp): Promise<DataServices> {
	data ??= (async () => {
		// Un rechazo se memoiza igual que un éxito: sin limpiar la referencia,
		// un fallo pasajero del import dinámico dejaría la aplicación sin datos
		// hasta recargar la página entera.
		const [{ getFirestore, connectFirestoreEmulator }, storageModule] =
			await Promise.all([
				import("firebase/firestore"),
				import("firebase/storage"),
			]);

		// La base de este proyecto no es la `(default)`.
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
 * Publica los servicios de Firebase y la sesión actual por contexto.
 * Envuelve al resto de la aplicación.
 */
@customElement("planu-firebase-provider")
export class PlanuFirebaseProvider extends LitElement {
	readonly #core = initializeFirebase();

	readonly #user = new ContextProvider(this, {
		context: userContext,
		// undefined = todavía comprobando. No es lo mismo que "sin sesión".
		initialValue: undefined,
	});

	readonly #firestore = new ContextProvider(this, {
		context: firestoreContext,
	});

	readonly #storage = new ContextProvider(this, { context: storageContext });

	#unsubscribe: (() => void) | undefined;

	constructor() {
		super();
		new ContextProvider(this, {
			context: appContext,
			initialValue: this.#core.app,
		});
		new ContextProvider(this, {
			context: authContext,
			initialValue: this.#core.auth,
		});
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.#unsubscribe = onAuthStateChanged(
			this.#core.auth,
			(user: User | null) => {
				this.#user.setValue(user);
				// Sólo hay datos que leer cuando hay sesión, así que es el momento
				// exacto de traer Firestore y Storage.
				if (user) void this.#provideDataServices();
			},
		);
	}

	/**
	 * Sin este `catch` el fallo era invisible: promesa rechazada sin manejar,
	 * los contextos nunca se rellenaban y la vista se quedaba esperando datos
	 * que no iban a llegar, sin decir nada.
	 */
	async #provideDataServices(): Promise<void> {
		try {
			const { firestore, storage } = await loadDataServices(this.#core.app);
			this.#firestore.setValue(firestore);
			this.#storage.setValue(storage);
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
