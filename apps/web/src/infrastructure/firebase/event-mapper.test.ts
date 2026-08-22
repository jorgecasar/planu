import type { Timestamp } from "firebase/firestore";
import { describe, expect, test, vi } from "vitest";

// Same pattern as `event-repository.test.ts`: a real class stands in for
// `Timestamp` so `instanceof` inside `toStoredEvent()` behaves like the
// SDK's, without pulling in an emulator. The real constructor takes seconds
// and nanoseconds, not a `Date`, which `fakeTimestamp()` below papers over
// for fixtures.
class FakeTimestamp {
	readonly #date: Date;
	constructor(date: Date) {
		this.#date = date;
	}
	toDate(): Date {
		return this.#date;
	}
}

vi.mock("firebase/firestore", () => ({ Timestamp: FakeTimestamp }));

const { toStoredEvent } = await import("./event-mapper.js");

const fakeTimestamp = (date: Date): Timestamp =>
	new FakeTimestamp(date) as unknown as Timestamp;

const BASE_DOCUMENT = {
	id: "event-1",
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

describe("toStoredEvent", () => {
	test("traduce un documento válido, con su id", () => {
		const event = toStoredEvent(BASE_DOCUMENT);

		expect(event).toMatchObject({ id: "event-1", title: "Cena" });
	});

	test("convierte Timestamp a Date en startDate y endDate", () => {
		const start = new Date(2026, 6, 4, 19, 30);
		const end = new Date(2026, 6, 4, 23, 0);

		const event = toStoredEvent({
			...BASE_DOCUMENT,
			startDate: fakeTimestamp(start),
			endDate: fakeTimestamp(end),
		});

		expect(event?.startDate).toEqual(start);
		expect(event?.endDate).toEqual(end);
	});

	test("un valor que no es Timestamp se convierte en null, no lanza", () => {
		const event = toStoredEvent({
			...BASE_DOCUMENT,
			startDate: "2026-07-04",
		});

		expect(event?.startDate).toBeNull();
	});

	test("un documento que no valida se descarta devolviendo null", () => {
		const event = toStoredEvent({ ...BASE_DOCUMENT, title: 42 });

		expect(event).toBeNull();
	});

	test("un evento sin el campo allDay (anterior a la funcionalidad) se trata como de día completo", () => {
		const { allDay: _allDay, ...withoutAllDay } = BASE_DOCUMENT;
		const event = toStoredEvent(withoutAllDay);

		expect(event?.allDay).toBe(true);
	});
});
