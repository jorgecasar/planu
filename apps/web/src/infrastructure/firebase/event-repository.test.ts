import type { Firestore } from "firebase/firestore";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PlanuEvent } from "../../lib/types.js";

// Same pattern as `analytics-adapter.test.ts`: mock the SDK functions this
// adapter calls, so `toContent()`'s field mapping and `create()`/`update()`'s
// document shape are tested without an emulator — the whole point of moving
// this logic behind a port.

const addDocMock = vi.fn();
const collectionMock = vi.fn((_db: unknown, name: string) => ({ path: name }));
const docMock = vi.fn((_db: unknown, name: string, id: string) => ({
	path: `${name}/${id}`,
}));
const getCountFromServerMock = vi.fn();
const queryMock = vi.fn((source: unknown, ...clauses: unknown[]) => ({
	source,
	clauses,
}));
const serverTimestampMock = vi.fn(() => "SERVER_TIMESTAMP");
const setDocMock = vi.fn();
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({
	field,
	op,
	value,
}));
const fromDateMock = vi.fn((date: Date) => ({ toDate: () => date }));

vi.mock("firebase/firestore", () => ({
	addDoc: addDocMock,
	collection: collectionMock,
	doc: docMock,
	getCountFromServer: getCountFromServerMock,
	query: queryMock,
	serverTimestamp: serverTimestampMock,
	setDoc: setDocMock,
	Timestamp: { fromDate: fromDateMock },
	where: whereMock,
}));

const { FirebaseEventRepository, toContent } = await import(
	"./event-repository.js"
);

const BASE_VALUES: PlanuEvent = {
	title: "Cena",
	description: undefined,
	location: undefined,
	startDate: null,
	endDate: null,
	allDay: true,
	imageUrl: undefined,
	userId: "abc",
	memberIds: [],
	roles: {},
	tags: [],
};

describe("toContent", () => {
	test("los campos de texto opcionales se guardan como cadena vacía, no null", () => {
		const content = toContent(BASE_VALUES);

		expect(content.description).toBe("");
		expect(content.location).toBe("");
		expect(content.imageUrl).toBe("");
	});

	test("sin fechas, startDate y endDate se guardan como null", () => {
		const content = toContent(BASE_VALUES);

		expect(content.startDate).toBeNull();
		expect(content.endDate).toBeNull();
		expect(fromDateMock).not.toHaveBeenCalled();
	});

	test("con fechas, pasan por Timestamp.fromDate", () => {
		const start = new Date(2026, 6, 4, 19, 30);
		const end = new Date(2026, 6, 4, 23, 0);

		const content = toContent({
			...BASE_VALUES,
			startDate: start,
			endDate: end,
		});

		expect(fromDateMock).toHaveBeenCalledWith(start);
		expect(fromDateMock).toHaveBeenCalledWith(end);
		expect(content.startDate).toEqual({ toDate: expect.any(Function) });
	});

	test("allDay y tags pasan sin transformar", () => {
		const content = toContent({
			...BASE_VALUES,
			allDay: false,
			tags: ["cine"],
		});

		expect(content.allDay).toBe(false);
		expect(content.tags).toEqual(["cine"]);
	});
});

describe("FirebaseEventRepository", () => {
	const repository = new FirebaseEventRepository({} as Firestore);

	beforeEach(() => {
		addDocMock.mockReset().mockResolvedValue({ id: "new-id" });
		getCountFromServerMock.mockReset();
		setDocMock.mockReset().mockResolvedValue(undefined);
		queryMock.mockClear();
		whereMock.mockClear();
		collectionMock.mockClear();
	});

	test("create() cuenta antes de escribir, no después", async () => {
		// The order matters: `first_event_created` needs the count of events
		// that existed *before* this write, and asking afterward would always
		// see at least one — the one just created.
		const order: string[] = [];
		getCountFromServerMock.mockImplementation(async () => {
			order.push("count");
			return { data: () => ({ count: 0 }) };
		});
		addDocMock.mockImplementation(async () => {
			order.push("addDoc");
			return { id: "new-id" };
		});

		await repository.create(BASE_VALUES, "owner-1");

		expect(order).toEqual(["count", "addDoc"]);
	});

	test("create() cuenta con memberIds array-contains el uid del dueño, no userId ==", () => {
		getCountFromServerMock.mockResolvedValue({ data: () => ({ count: 0 }) });

		void repository.create(BASE_VALUES, "owner-1");

		expect(whereMock).toHaveBeenCalledWith(
			"memberIds",
			"array-contains",
			"owner-1",
		);
	});

	test("create() devuelve wasFirstEvent: true cuando el recuento previo es cero", async () => {
		getCountFromServerMock.mockResolvedValue({ data: () => ({ count: 0 }) });

		const created = await repository.create(BASE_VALUES, "owner-1");

		expect(created).toEqual({ id: "new-id", wasFirstEvent: true });
	});

	test("create() devuelve wasFirstEvent: false cuando ya había eventos", async () => {
		getCountFromServerMock.mockResolvedValue({ data: () => ({ count: 3 }) });

		const created = await repository.create(BASE_VALUES, "owner-1");

		expect(created.wasFirstEvent).toBe(false);
	});

	test("create() escribe al dueño como único miembro, sin invitados", async () => {
		getCountFromServerMock.mockResolvedValue({ data: () => ({ count: 0 }) });

		await repository.create(BASE_VALUES, "owner-1");

		expect(addDocMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "owner-1",
				memberIds: ["owner-1"],
				roles: {},
				createdAt: "SERVER_TIMESTAMP",
			}),
		);
	});

	test("update() no toca userId, memberIds ni roles: sólo contenido, con merge", async () => {
		await repository.update("event-1", { ...BASE_VALUES, title: "Editado" });

		expect(setDocMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ title: "Editado" }),
			{ merge: true },
		);
		const [, written] = setDocMock.mock.calls[0] as [unknown, object];
		expect(written).not.toHaveProperty("userId");
		expect(written).not.toHaveProperty("memberIds");
		expect(written).not.toHaveProperty("roles");
	});
});
