import { expect, test, vi } from "vitest";
import type { PlanuEvent } from "../lib/types.js";
import type { AnalyticsPort } from "./ports/analytics.js";
import type { EventRepositoryPort } from "./ports/event-repository.js";
import { type SaveEventRequest, saveEvent } from "./save-event.js";

function fakeRepository() {
	return {
		create: vi.fn().mockResolvedValue({ id: "nuevo" }),
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		leave: vi.fn().mockResolvedValue(undefined),
	} satisfies EventRepositoryPort;
}

function fakeAnalytics() {
	return {
		trackSignUp: vi.fn(),
		trackFirstEventCreated: vi.fn(),
		trackShare: vi.fn(),
		trackAiUsed: vi.fn(),
	} satisfies AnalyticsPort;
}

const timed: PlanuEvent = {
	title: "Cena",
	startDate: new Date(2026, 6, 4, 19, 30),
	endDate: new Date(2026, 6, 4, 23),
	allDay: false,
	memberIds: [],
	roles: {},
	tags: [],
};

const request = (overrides: Partial<SaveEventRequest> = {}) => ({
	values: timed,
	ownerUid: "abc",
	editingId: undefined,
	isFirstEvent: () => false,
	...overrides,
});

test("crear lo da de alta a nombre de quien crea y devuelve su id", async () => {
	const repository = fakeRepository();
	const analytics = fakeAnalytics();

	await expect(saveEvent(repository, analytics, request())).resolves.toBe(
		"nuevo",
	);
	expect(repository.create).toHaveBeenCalledWith(timed, "abc");
	expect(repository.update).not.toHaveBeenCalled();
	expect(analytics.trackFirstEventCreated).not.toHaveBeenCalled();
});

test("el primer evento se anota una vez, aunque el listado lo desmienta antes de que acabe la escritura", async () => {
	// Latency compensation (GH-94): the listing already holds the new event —
	// so the flag reads false — before `create()` resolves.
	let first = true;
	const repository = fakeRepository();
	repository.create.mockImplementation(async () => {
		first = false;
		return { id: "nuevo" };
	});
	const analytics = fakeAnalytics();

	await saveEvent(
		repository,
		analytics,
		request({ isFirstEvent: () => first }),
	);

	expect(analytics.trackFirstEventCreated).toHaveBeenCalledOnce();
});

test("editar sólo actualiza el contenido, y nunca cuenta como primer evento", async () => {
	const repository = fakeRepository();
	const analytics = fakeAnalytics();

	await expect(
		saveEvent(
			repository,
			analytics,
			request({ editingId: "e1", isFirstEvent: () => true }),
		),
	).resolves.toBeUndefined();

	expect(repository.update).toHaveBeenCalledWith("e1", timed);
	expect(repository.create).not.toHaveBeenCalled();
	expect(analytics.trackFirstEventCreated).not.toHaveBeenCalled();
});

test("si la escritura falla, lo propaga y no anota nada", async () => {
	const repository = fakeRepository();
	repository.create.mockRejectedValue(new Error("permission-denied"));
	const analytics = fakeAnalytics();

	await expect(
		saveEvent(repository, analytics, request({ isFirstEvent: () => true })),
	).rejects.toThrow("permission-denied");
	expect(analytics.trackFirstEventCreated).not.toHaveBeenCalled();
});

test("un evento de día completo se guarda a medianoche local, al crear y al editar; uno con hora, tal cual", async () => {
	const repository = fakeRepository();
	const analytics = fakeAnalytics();

	await saveEvent(
		repository,
		analytics,
		request({ values: { ...timed, allDay: true, endDate: null } }),
	);
	await saveEvent(repository, analytics, request());

	expect(repository.create.mock.calls[0]?.[0]).toMatchObject({
		startDate: new Date(2026, 6, 4),
		endDate: null,
	});
	expect(repository.create.mock.calls[1]?.[0]).toBe(timed);

	// Editing goes through the same normalisation.
	const edit = { values: { ...timed, allDay: true }, editingId: "e1" };
	await saveEvent(repository, analytics, request(edit));
	expect(repository.update).toHaveBeenCalledWith(
		"e1",
		expect.objectContaining({ startDate: new Date(2026, 6, 4) }),
	);
});
