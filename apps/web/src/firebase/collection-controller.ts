import {
	type DocumentData,
	type FirestoreError,
	onSnapshot,
	type Query,
	queryEqual,
} from "firebase/firestore";
import type { ReactiveController, ReactiveControllerHost } from "lit";

export type WithId<T> = T & { id: string };

/**
 * Suscribe al host a una consulta de Firestore en tiempo real.
 *
 * Equivalente al hook `useCollection` del prototipo. No se usa `@lit/task`
 * porque esto no es una promesa sino un flujo: `onSnapshot` emite tantas veces
 * como cambien los datos.
 */
export class CollectionController<T extends DocumentData>
	implements ReactiveController
{
	readonly #host: ReactiveControllerHost;
	#query: Query<T> | null = null;
	#unsubscribe: (() => void) | undefined;
	#connected = false;

	data: WithId<T>[] = [];
	loading = false;
	error: FirestoreError | null = null;

	constructor(host: ReactiveControllerHost) {
		this.#host = host;
		host.addController(this);
	}

	/**
	 * Fija la consulta a observar. Ignora consultas equivalentes a la vigente:
	 * sin esta comprobación cada render crearía una suscripción nueva.
	 */
	setQuery(query: Query<T> | null): void {
		if (query === null && this.#query === null) return;
		if (query && this.#query && queryEqual(this.#query, query)) return;

		this.#query = query;
		this.#subscribe();
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

	#subscribe(): void {
		this.#stop();

		const query = this.#query;
		if (!this.#connected || !query) {
			this.data = [];
			this.loading = false;
			this.#host.requestUpdate();
			return;
		}

		this.loading = true;
		this.error = null;
		this.#host.requestUpdate();

		this.#unsubscribe = onSnapshot(
			query,
			(snapshot) => {
				this.data = snapshot.docs.map(
					(document) => ({ ...document.data(), id: document.id }) as WithId<T>,
				);
				this.loading = false;
				this.error = null;
				this.#host.requestUpdate();
			},
			(error) => {
				this.error = error;
				this.loading = false;
				this.#host.requestUpdate();
			},
		);
	}
}
