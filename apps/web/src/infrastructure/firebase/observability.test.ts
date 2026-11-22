import type { FirebaseApp } from "firebase/app";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createConsentStore } from "../../domain/consent.js";

// Firebase Performance still starts unconditionally here: it is gated by the
// next card (HU-439). Mocked so the real SDK never loads in these tests.
const getPerformanceMock = vi.fn(() => ({}));
vi.mock("firebase/performance", () => ({ getPerformance: getPerformanceMock }));

const startErrorTrackingMock = vi.fn(async () => {});
const stopErrorTrackingMock = vi.fn(async () => {});
vi.mock("../sentry/index.js", () => ({
	afterMainPaint: (task: () => void) => task(),
	startErrorTracking: startErrorTrackingMock,
	stopErrorTracking: stopErrorTrackingMock,
}));

const { errorTrackingToggle, gateByConsent, startObservability } = await import(
	"./observability.js"
);

const FAKE_APP = {} as FirebaseApp;

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
};

const consentWith = (decision?: "granted" | "denied") => {
	const store = createConsentStore(memoryStorage());
	if (decision) store.set(decision);
	return store;
};

// Long enough for the lazy imports to settle, so a negative assertion cannot
// pass just because it had not run yet.
const flush = () => new Promise((resolve) => setTimeout(resolve, 100));

const fakeToggle = () => ({
	enable: vi.fn(async () => {}),
	disable: vi.fn(async () => {}),
});

describe("gateByConsent", () => {
	test("starts nothing while the visitor has not decided", () => {
		const toggle = fakeToggle();

		gateByConsent(consentWith(), toggle);

		expect(toggle.enable).not.toHaveBeenCalled();
	});

	test("starts nothing when the visitor refused", () => {
		const toggle = fakeToggle();

		gateByConsent(consentWith("denied"), toggle);

		expect(toggle.enable).not.toHaveBeenCalled();
		expect(toggle.disable).not.toHaveBeenCalled();
	});

	test("starts once when consent was already granted", () => {
		const toggle = fakeToggle();

		gateByConsent(consentWith("granted"), toggle);

		expect(toggle.enable).toHaveBeenCalledTimes(1);
	});

	test("starts when consent is granted later, and only then", () => {
		const consent = consentWith();
		const toggle = fakeToggle();
		gateByConsent(consent, toggle);

		consent.set("granted");

		expect(toggle.enable).toHaveBeenCalledTimes(1);
	});

	test("stops when consent is withdrawn", () => {
		const consent = consentWith("granted");
		const toggle = fakeToggle();
		gateByConsent(consent, toggle);

		consent.set("denied");

		expect(toggle.disable).toHaveBeenCalledTimes(1);
	});

	test("starts again if consent is granted again after a withdrawal", () => {
		const consent = consentWith("granted");
		const toggle = fakeToggle();
		gateByConsent(consent, toggle);

		consent.set("denied");
		consent.set("granted");

		expect(toggle.enable).toHaveBeenCalledTimes(2);
	});

	test("does not stop what never started", () => {
		const consent = consentWith("denied");
		const toggle = fakeToggle();
		gateByConsent(consent, toggle);

		consent.set("denied");
		consent.clear();

		expect(toggle.disable).not.toHaveBeenCalled();
	});

	test("never lets a failing starter break the app", async () => {
		const toggle = {
			enable: vi.fn(async () => {
				throw new Error("sdk failed");
			}),
			disable: vi.fn(async () => {}),
		};

		expect(() => gateByConsent(consentWith("granted"), toggle)).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

describe("startObservability", () => {
	beforeEach(() => {
		startErrorTrackingMock.mockClear();
		vi.stubEnv("DEV", false);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("in production Sentry starts nothing before consent and starts after it", async () => {
		const consent = consentWith();

		startObservability(FAKE_APP, consent);
		await flush();
		expect(startErrorTrackingMock).not.toHaveBeenCalled();

		consent.set("granted");
		await flush();

		expect(startErrorTrackingMock).toHaveBeenCalledTimes(1);
	});

	test("a refusal keeps Sentry off", async () => {
		startObservability(FAKE_APP, consentWith("denied"));
		await flush();

		expect(startErrorTrackingMock).not.toHaveBeenCalled();
	});
});

describe("the Sentry toggle", () => {
	beforeEach(() => {
		startErrorTrackingMock.mockClear();
		stopErrorTrackingMock.mockClear();
	});

	test("Sentry starts only after consent and closes when it is withdrawn", async () => {
		const consent = consentWith();
		gateByConsent(consent, errorTrackingToggle());
		expect(startErrorTrackingMock).not.toHaveBeenCalled();

		consent.set("granted");
		expect(startErrorTrackingMock).toHaveBeenCalledTimes(1);

		consent.set("denied");
		expect(stopErrorTrackingMock).toHaveBeenCalledTimes(1);
	});
});
