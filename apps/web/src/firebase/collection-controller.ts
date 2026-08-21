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
 * Subscribes the host to a real-time Firestore query.
 *
 * Equivalent to the prototype's `useCollection` hook. `@lit/task` is not used
 * because this is not a promise but a stream: `onSnapshot` emits as many
 * times as the data changes.
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
	 * Sets the query to watch. Ignores queries equivalent to the current one:
	 * without this check, every render would create a new subscription.
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
