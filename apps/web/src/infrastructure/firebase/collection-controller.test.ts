import type { DocumentData, Query } from "firebase/firestore";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { beforeEach, expect, test, vi } from "vitest";

/** State of the `onSnapshot` double, shared with the module mock. */
const spy = {
	subscriptions: 0,
	unsubscriptions: 0,
	emit: undefined as
		| ((docs: { id: string; data: DocumentData }[]) => void)
		| undefined,
	fail: undefined as ((error: unknown) => void) | undefined,
};

vi.mock("firebase/firestore", () => ({
	onSnapshot: (
		_query: unknown,
		onNext: (snapshot: unknown) => void,
		onError: (error: unknown) => void,
	) => {
		spy.subscriptions++;
		spy.emit = (docs) => {
			onNext({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });
		};
		spy.fail = onError;
		return () => {
			spy.unsubscriptions++;
		};
	},
	// Two queries are the same if they are the same object: enough for these tests.
	queryEqual: (a: unknown, b: unknown) => a === b,
	refEqual: (a: unknown, b: unknown) => a === b,
}));

const { CollectionController } = await import("./collection-controller.js");

/** Minimal host that counts the `requestUpdate` calls it receives. */
class FakeHost implements ReactiveControllerHost {
	updates = 0;
	readonly controllers: ReactiveController[] = [];
	readonly updateComplete = Promise.resolve(true);

	addController(controller: ReactiveController): void {
		this.controllers.push(controller);
	}
	removeController(): void {}
	requestUpdate(): void {
		this.updates++;
	}
}

const query = (): Query<DocumentData> => ({}) as Query<DocumentData>;

beforeEach(() => {
	spy.subscriptions = 0;
	spy.unsubscriptions = 0;
});

test("no se suscribe hasta que el host se conecta y hay consulta", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);

	controller.setQuery(query());
	expect(spy.subscriptions).toBe(0);

	controller.hostConnected();
	expect(spy.subscriptions).toBe(1);
});

test("expone los documentos con su id", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();
	controller.setQuery(query());

	spy.emit?.([{ id: "abc", data: { title: "Cumpleaños" } }]);

	expect(controller.data).toEqual([{ id: "abc", title: "Cumpleaños" }]);
	expect(controller.loading).toBe(false);
});

test("ignora una consulta equivalente y no resuscribe", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();

	const q = query();
	controller.setQuery(q);
	controller.setQuery(q);
	controller.setQuery(q);

	expect(spy.subscriptions).toBe(1);
});

test("resuscribe cuando la consulta cambia de verdad", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();

	controller.setQuery(query());
	controller.setQuery(query());

	expect(spy.subscriptions).toBe(2);
	expect(spy.unsubscriptions).toBe(1);
});

test("se desuscribe al desconectarse el host", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();
	controller.setQuery(query());

	controller.hostDisconnected();

	expect(spy.unsubscriptions).toBe(1);
});

test("una consulta nula limpia los datos y corta la suscripción", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();
	controller.setQuery(query());
	spy.emit?.([{ id: "abc", data: { title: "Cumpleaños" } }]);

	controller.setQuery(null);

	expect(controller.data).toEqual([]);
	expect(spy.unsubscriptions).toBe(1);
});

test("registra el error y deja de cargar", () => {
	const host = new FakeHost();
	const controller = new CollectionController(host);
	controller.hostConnected();
	controller.setQuery(query());

	const error = new Error("permission-denied");
	spy.fail?.(error);

	expect(controller.error).toBe(error);
	expect(controller.loading).toBe(false);
});
