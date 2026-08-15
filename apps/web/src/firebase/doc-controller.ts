import {
	type DocumentData,
	type DocumentReference,
	type FirestoreError,
	onSnapshot,
	refEqual,
} from "firebase/firestore";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { WithId } from "./collection-controller.js";

/**
 * Suscribe al host a un documento de Firestore en tiempo real.
 * Equivalente al hook `useDoc` del prototipo.
 */
export class DocController<T extends DocumentData>
	implements ReactiveController
{
	readonly #host: ReactiveControllerHost;
	#ref: DocumentReference<T> | null = null;
	#unsubscribe: (() => void) | undefined;
	#connected = false;

	data: WithId<T> | null = null;
	loading = false;
	error: FirestoreError | null = null;

	constructor(host: ReactiveControllerHost) {
		this.#host = host;
		host.addController(this);
	}

	setRef(ref: DocumentReference<T> | null): void {
		if (ref === null && this.#ref === null) return;
		if (ref && this.#ref && refEqual(this.#ref, ref)) return;

		this.#ref = ref;
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

		const ref = this.#ref;
		if (!this.#connected || !ref) {
			this.data = null;
			this.loading = false;
			this.#host.requestUpdate();
			return;
		}

		this.loading = true;
		this.error = null;
		this.#host.requestUpdate();

		this.#unsubscribe = onSnapshot(
			ref,
			(snapshot) => {
				this.data = snapshot.exists()
					? ({ ...snapshot.data(), id: snapshot.id } as WithId<T>)
					: null;
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
