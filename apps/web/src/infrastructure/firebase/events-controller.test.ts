import type { DocumentData } from "firebase/firestore";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { beforeEach, describe, expect, test, vi } from "vitest";

/** Same double as `collection-controller.test.ts`, plus the query builders
 * `EventsController` calls on top of it. */
const spy = {
	subscriptions: 0,
	unsubscriptions: 0,
	emit: undefined as
		| ((docs: { id: string; data: DocumentData }[]) => void)
		| undefined,
	fail: undefined as ((error: unknown) => void) | undefined,
};

const collectionMock = vi.fn((_db: unknown, name: string) => ({ path: name }));
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({
	field,
	op,
	value,
}));
const queryMock = vi.fn((source: unknown, ...clauses: unknown[]) => ({
	source,
	clauses,
}));

/** `event-mapper.ts`'s `toStoredEvent()` needs a real class for `instanceof`;
 * these tests never construct one, so it's only here to satisfy the import. */
class FakeTimestamp {
	toDate(): Date {
		return new Date(0);
	}
}

vi.mock("firebase/firestore", () => ({
	collection: collectionMock,
	query: queryMock,
	where: whereMock,
	Timestamp: FakeTimestamp,
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
	queryEqual: (a: unknown, b: unknown) => a === b,
}));

const { EventsController } = await import("./events-controller.js");

/** Minimal host, same as `collection-controller.test.ts`'s. */
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
	connect(): void {
		for (const controller of this.controllers) controller.hostConnected?.();
	}
}

const EVENT_DOCUMENT = {
	title: "Cena",
	description: "",
	location: "",
	imageUrl: "",
	userId: "owner-1",
	memberIds: ["owner-1"],
	roles: {},
	startDate: null,
	endDate: null,
	createdAt: null,
	tags: [],
	allDay: true,
};

/** A connected controller, ready to have `setFirestore`/`setUid`/
 * `setInterested` called on it. */
function newController() {
	const host = new FakeHost();
	const controller = new EventsController(host);
	host.connect();
	return controller;
}

/** The three inputs a subscription needs, all satisfied at once — most
 * tests don't care about the order they arrive in, just the end state. */
function readyController() {
	const controller = newController();
	controller.setFirestore({} as never);
	controller.setUid("owner-1");
	controller.setInterested(true);
	return controller;
}

beforeEach(() => {
	spy.subscriptions = 0;
	spy.unsubscriptions = 0;
	collectionMock.mockClear();
	whereMock.mockClear();
	queryMock.mockClear();
});

test("sin uid ni firestore ni interés no se suscribe y el estado es ready sin eventos", () => {
	const controller = newController();

	expect(spy.subscriptions).toBe(0);
	expect(controller.snapshot).toEqual({ status: "ready", events: [] });
});

test("con uid pero sin firestore el estado es loading", () => {
	const controller = newController();

	controller.setUid("owner-1");
	controller.setInterested(true);

	expect(spy.subscriptions).toBe(0);
	expect(controller.snapshot).toEqual({ status: "loading", events: [] });
});

test("con uid y firestore pero sin interés no se suscribe, y el estado es loading", () => {
	// The regression this guards: before `setInterested` existed, having a
	// uid and a Firestore instance was enough to open the subscription and
	// keep it open on every route for the rest of the session, not just the
	// one that actually shows the listing.
	const controller = newController();

	controller.setFirestore({} as never);
	controller.setUid("owner-1");

	expect(spy.subscriptions).toBe(0);
	expect(controller.snapshot).toEqual({ status: "loading", events: [] });
});

test("con firestore, uid e interés consulta por memberIds array-contains el uid", () => {
	readyController();

	expect(spy.subscriptions).toBe(1);
	expect(whereMock).toHaveBeenCalledWith(
		"memberIds",
		"array-contains",
		"owner-1",
	);
	expect(collectionMock).toHaveBeenCalledWith(expect.anything(), "events");
});

test("mientras no llega el primer snapshot el estado es loading", () => {
	const controller = readyController();

	expect(controller.snapshot.status).toBe("loading");
});

test("al llegar datos válidos el estado pasa a ready con los eventos traducidos", () => {
	const controller = readyController();

	spy.emit?.([{ id: "event-1", data: EVENT_DOCUMENT }]);

	expect(controller.snapshot).toEqual({
		status: "ready",
		events: [expect.objectContaining({ id: "event-1", title: "Cena" })],
	});
});

test("un documento que no valida se descarta sin tumbar la lista", () => {
	const controller = readyController();

	spy.emit?.([
		{ id: "event-1", data: EVENT_DOCUMENT },
		{ id: "invalid", data: { ...EVENT_DOCUMENT, title: 42 } },
	]);

	expect(controller.snapshot.events).toHaveLength(1);
});

test("un fallo del snapshot pasa el estado a error", () => {
	const controller = readyController();

	spy.fail?.(new Error("permission-denied"));

	expect(controller.snapshot).toEqual({ status: "error", events: [] });
});

test("cambiar de uid resuscribe; repetir el mismo no", () => {
	const controller = readyController();
	expect(spy.subscriptions).toBe(1);

	controller.setUid("owner-1");
	expect(spy.subscriptions).toBe(1);

	controller.setUid("owner-2");
	expect(spy.subscriptions).toBe(2);
	expect(spy.unsubscriptions).toBe(1);
});

test("perder el uid limpia la lista y corta la suscripción", () => {
	const controller = readyController();
	spy.emit?.([{ id: "event-1", data: EVENT_DOCUMENT }]);

	controller.setUid(undefined);

	expect(spy.unsubscriptions).toBe(1);
	expect(controller.snapshot).toEqual({ status: "ready", events: [] });
});

test("el snapshot de eventos es la misma referencia mientras no cambian los datos", () => {
	// `firebase-provider.ts` compares `.events` by reference to decide
	// whether to republish `eventsContext`; if this ever reallocated on every
	// read, that comparison would never dedupe and every unrelated re-render
	// would push a "new" snapshot downstream.
	const controller = readyController();
	spy.emit?.([{ id: "event-1", data: EVENT_DOCUMENT }]);

	const first = controller.snapshot;
	const second = controller.snapshot;

	expect(first.events).toBe(second.events);
});

describe("interés — el ciclo de vida que este controlador existe para reproducir", () => {
	test("perder el interés cierra la suscripción aunque uid y firestore sigan puestos", () => {
		const controller = readyController();
		expect(spy.subscriptions).toBe(1);

		controller.setInterested(false);

		expect(spy.unsubscriptions).toBe(1);
		// "loading", no "ready": con uid puesto pero sin interés, nadie está
		// mirando `eventsContext` — no hay una vista que pueda malinterpretar
		// "cero eventos" como "de verdad no tienes ninguno".
		expect(controller.snapshot).toEqual({ status: "loading", events: [] });
	});

	test("recuperar el interés reabre la suscripción con el mismo uid", () => {
		const controller = readyController();
		controller.setInterested(false);
		spy.subscriptions = 0;

		controller.setInterested(true);

		expect(spy.subscriptions).toBe(1);
	});

	test("repetir el mismo interés no reabre ni recierra la suscripción", () => {
		const controller = readyController();
		expect(spy.subscriptions).toBe(1);

		controller.setInterested(true);

		expect(spy.subscriptions).toBe(1);
		expect(spy.unsubscriptions).toBe(0);
	});

	test("sin interés todavía, tener uid y firestore no abre nada por sí solo", () => {
		const controller = newController();

		controller.setFirestore({} as never);
		controller.setUid("owner-1");
		controller.setFirestore({} as never);

		expect(spy.subscriptions).toBe(0);
	});
});

describe("orden de llegada", () => {
	test("el uid puede llegar antes que firestore, sin suscribirse hasta tener los tres", () => {
		const controller = newController();

		controller.setUid("owner-1");
		expect(spy.subscriptions).toBe(0);

		controller.setFirestore({} as never);
		expect(spy.subscriptions).toBe(0);

		controller.setInterested(true);
		expect(spy.subscriptions).toBe(1);
	});

	test("el interés puede llegar antes que uid y firestore", () => {
		const controller = newController();

		controller.setInterested(true);
		expect(spy.subscriptions).toBe(0);

		controller.setFirestore({} as never);
		expect(spy.subscriptions).toBe(0);

		controller.setUid("owner-1");
		expect(spy.subscriptions).toBe(1);
	});
});
