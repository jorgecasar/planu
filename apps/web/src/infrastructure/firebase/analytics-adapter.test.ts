import type { FirebaseApp } from "firebase/app";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { noopAnalytics } from "../../application/ports/analytics.js";

const logEventMock = vi.fn();
const isSupportedMock = vi.fn<() => Promise<boolean>>();
const getAnalyticsMock = vi.fn(() => ({}) as never);

vi.mock("firebase/analytics", () => ({
	getAnalytics: getAnalyticsMock,
	isSupported: isSupportedMock,
	logEvent: logEventMock,
}));

const FAKE_APP = {} as FirebaseApp;

describe("adaptador de Firebase Analytics", () => {
	beforeEach(() => {
		vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "G-FAKE");
		logEventMock.mockClear();
		isSupportedMock.mockReset();
		getAnalyticsMock.mockClear();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("sin measurementId, devuelve el puerto vacío sin inicializar Analytics", async () => {
		vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "");
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP);

		expect(port).toBe(noopAnalytics);
		expect(getAnalyticsMock).not.toHaveBeenCalled();
		expect(() => port.trackSignUp()).not.toThrow();
	});

	test("con measurementId pero isSupported() en false, devuelve el puerto vacío", async () => {
		isSupportedMock.mockResolvedValue(false);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		// El caso que T31 exige no romper: un bloqueador, o un navegador sin
		// IndexedDB. La aplicación sigue funcionando igual.
		const port = await createAnalyticsAdapter(FAKE_APP);

		expect(port).toBe(noopAnalytics);
		expect(getAnalyticsMock).not.toHaveBeenCalled();
	});

	test("si isSupported() rechaza, devuelve el puerto vacío sin lanzar", async () => {
		isSupportedMock.mockRejectedValue(new Error("boom"));
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		await expect(createAnalyticsAdapter(FAKE_APP)).resolves.toBe(noopAnalytics);
	});

	test("inicializado y soportado, cada método registra su evento con sus parámetros", async () => {
		isSupportedMock.mockResolvedValue(true);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP);
		port.trackSignUp();
		port.trackFirstEventCreated();
		port.trackShare({ editable: true });
		port.trackAiUsed({ fromImage: false });

		expect(logEventMock).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			"sign_up",
		);
		expect(logEventMock).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			"first_event_created",
			{ totalEvents: 1 },
		);
		expect(logEventMock).toHaveBeenNthCalledWith(
			3,
			expect.anything(),
			"share",
			{
				editable: true,
			},
		);
		expect(logEventMock).toHaveBeenNthCalledWith(
			4,
			expect.anything(),
			"ai_used",
			{ fromImage: false },
		);
	});

	test("si logEvent lanza, el método lo traga sin propagar", async () => {
		isSupportedMock.mockResolvedValue(true);
		logEventMock.mockImplementation(() => {
			throw new Error("network down");
		});
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP);

		expect(() => port.trackAiUsed({ fromImage: true })).not.toThrow();
	});
});
