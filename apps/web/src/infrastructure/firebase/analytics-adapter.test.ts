import type { FirebaseApp } from "firebase/app";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { noopAnalytics } from "../../application/ports/analytics.js";

import { createConsentStore } from "../../domain/consent.js";

const logEventMock = vi.fn();
const isSupportedMock = vi.fn<() => Promise<boolean>>();
const getAnalyticsMock = vi.fn(() => ({}) as never);
const setEnabledMock = vi.fn();

vi.mock("firebase/analytics", () => ({
	getAnalytics: getAnalyticsMock,
	isSupported: isSupportedMock,
	logEvent: logEventMock,
	setAnalyticsCollectionEnabled: setEnabledMock,
}));

const FAKE_APP = {} as FirebaseApp;

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
};

/** A consent store already holding `decision` (or nothing). */
const consentWith = (decision?: "granted" | "denied") => {
	const store = createConsentStore(memoryStorage());
	if (decision) store.set(decision);
	return store;
};

// Long enough for the lazy `import("firebase/analytics")` to settle, so the
// negative assertions below cannot pass just because it had not run yet.
const flush = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("adaptador de Firebase Analytics", () => {
	beforeEach(() => {
		vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "G-FAKE");
		logEventMock.mockClear();
		isSupportedMock.mockReset();
		getAnalyticsMock.mockClear();
		setEnabledMock.mockClear();
		logEventMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("sin measurementId, devuelve el puerto vacío sin inicializar Analytics", async () => {
		vi.stubEnv("VITE_FIREBASE_MEASUREMENT_ID", "");
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP, consentWith("granted"));

		expect(port).toBe(noopAnalytics);
		expect(getAnalyticsMock).not.toHaveBeenCalled();
		expect(() => port.trackSignUp()).not.toThrow();
	});

	test.each([
		["unset", undefined],
		["denied", "denied"],
	] as const)(
		"con consentimiento %s no se carga el SDK ni se envía nada",
		async (_label, decision) => {
			isSupportedMock.mockResolvedValue(true);
			const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

			const port = await createAnalyticsAdapter(
				FAKE_APP,
				consentWith(decision),
			);
			port.trackSignUp();
			port.trackFirstEventCreated();
			port.trackShare({ editable: true });
			port.trackAiUsed({ fromImage: true });
			await flush();

			expect(isSupportedMock).not.toHaveBeenCalled();
			expect(getAnalyticsMock).not.toHaveBeenCalled();
			expect(logEventMock).not.toHaveBeenCalled();
		},
	);

	test("al aceptar después, arranca y desde entonces registra", async () => {
		isSupportedMock.mockResolvedValue(true);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");
		const consent = consentWith();
		const port = await createAnalyticsAdapter(FAKE_APP, consent);
		port.trackSignUp();
		await flush();
		expect(logEventMock).not.toHaveBeenCalled();

		consent.set("granted");
		await vi.waitFor(() => expect(getAnalyticsMock).toHaveBeenCalledTimes(1));
		port.trackSignUp();

		await vi.waitFor(() => expect(logEventMock).toHaveBeenCalledTimes(1));
	});

	test("al retirar el consentimiento detiene la medición y no registra", async () => {
		isSupportedMock.mockResolvedValue(true);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");
		const consent = consentWith("granted");
		const port = await createAnalyticsAdapter(FAKE_APP, consent);
		await vi.waitFor(() => expect(getAnalyticsMock).toHaveBeenCalled());

		consent.set("denied");
		await vi.waitFor(() =>
			expect(setEnabledMock).toHaveBeenLastCalledWith(expect.anything(), false),
		);
		port.trackSignUp();
		await flush();
		expect(logEventMock).not.toHaveBeenCalled();

		consent.set("granted");
		await vi.waitFor(() =>
			expect(setEnabledMock).toHaveBeenLastCalledWith(expect.anything(), true),
		);
		port.trackSignUp();
		await vi.waitFor(() => expect(logEventMock).toHaveBeenCalledTimes(1));
	});

	test("si se retira mientras el SDK carga, el evento se descarta", async () => {
		isSupportedMock.mockResolvedValue(true);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");
		const consent = consentWith("granted");
		const port = await createAnalyticsAdapter(FAKE_APP, consent);

		port.trackSignUp();
		consent.set("denied");
		await flush();

		expect(logEventMock).not.toHaveBeenCalled();
	});

	test("con isSupported() en false no inicializa ni registra", async () => {
		isSupportedMock.mockResolvedValue(false);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		// El caso que T31 exige no romper: un bloqueador, o un navegador sin
		// IndexedDB. La aplicación sigue funcionando igual.
		const port = await createAnalyticsAdapter(FAKE_APP, consentWith("granted"));
		port.trackSignUp();
		await flush();

		expect(getAnalyticsMock).not.toHaveBeenCalled();
		expect(logEventMock).not.toHaveBeenCalled();
	});

	test("si isSupported() rechaza, no lanza", async () => {
		isSupportedMock.mockRejectedValue(new Error("boom"));
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP, consentWith("granted"));
		expect(() => port.trackSignUp()).not.toThrow();
		await flush();
		expect(logEventMock).not.toHaveBeenCalled();
	});

	test("inicializado y soportado, cada método registra su evento con sus parámetros", async () => {
		isSupportedMock.mockResolvedValue(true);
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP, consentWith("granted"));
		port.trackSignUp();
		port.trackFirstEventCreated();
		port.trackShare({ editable: true });
		port.trackAiUsed({ fromImage: false });
		await vi.waitFor(() => expect(logEventMock).toHaveBeenCalledTimes(4));

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

	test("si logEvent lanza, cada método lo traga sin propagar", async () => {
		isSupportedMock.mockResolvedValue(true);
		logEventMock.mockImplementation(() => {
			throw new Error("network down");
		});
		const { createAnalyticsAdapter } = await import("./analytics-adapter.js");

		const port = await createAnalyticsAdapter(FAKE_APP, consentWith("granted"));

		expect(() => port.trackSignUp()).not.toThrow();
		expect(() => port.trackFirstEventCreated()).not.toThrow();
		expect(() => port.trackShare({ editable: true })).not.toThrow();
		expect(() => port.trackAiUsed({ fromImage: true })).not.toThrow();
		await vi.waitFor(() => expect(logEventMock).toHaveBeenCalledTimes(4));
	});
});
