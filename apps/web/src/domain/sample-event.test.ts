import { expect, test } from "vitest";
import { sampleEventDraft } from "./sample-event.js";

test("trae título, descripción, ubicación y las dos fechas", () => {
	const draft = sampleEventDraft(new Date("2026-08-21T00:00:00Z"));

	expect(draft.title).toBe("Dinner with friends");
	expect(draft.description).toBeTruthy();
	expect(draft.location).toBeTruthy();
	expect(draft.startDate).toBeInstanceOf(Date);
	expect(draft.endDate).toBeInstanceOf(Date);
});

test('el inicio es relativo a "now" y no una fecha fija', () => {
	// Igual que en `scripts/seed-emulator.js`: un dato fijo deja de "verse"
	// próximo con el paso del tiempo, y el ejemplo perdería su sentido.
	const now = new Date("2026-01-01T00:00:00Z");
	const start = sampleEventDraft(now).startDate as Date;

	expect(start.getTime()).toBeGreaterThan(now.getTime());

	const unMesEnMs = 31 * 24 * 60 * 60 * 1000;
	expect(start.getTime() - now.getTime()).toBeLessThan(unMesEnMs);
});

test("el fin no es anterior al inicio", () => {
	const draft = sampleEventDraft(new Date("2026-03-10T00:00:00Z"));

	expect((draft.endDate as Date).getTime()).toBeGreaterThanOrEqual(
		(draft.startDate as Date).getTime(),
	);
});

test("sin argumento usa el instante actual", () => {
	const antes = Date.now();
	const start = (sampleEventDraft().startDate as Date).getTime();
	const despues = Date.now();

	expect(start).toBeGreaterThan(antes);
	// Con margen de sobra: no depende de a qué hora corra el test.
	expect(start).toBeLessThan(despues + 8 * 24 * 60 * 60 * 1000);
});
