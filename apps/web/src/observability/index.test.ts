import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const captureException = vi.fn();
const addBreadcrumb = vi.fn();
vi.mock("@sentry/browser", () => ({ captureException, addBreadcrumb }));

const { recordBackgroundWrite } = await import("./index.js");

describe("recordBackgroundWrite()", () => {
	beforeEach(() => {
		vi.stubEnv("DEV", false);
		vi.stubEnv("VITE_SENTRY_DSN", "https://key@sentry.invalid/1");
		captureException.mockReset();
		addBreadcrumb.mockReset();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	test.each([
		["in development", "DEV", true],
		["without a DSN", "VITE_SENTRY_DSN", ""],
	] as const)("schedules nothing %s", (_, key, value) => {
		vi.stubEnv(key, value);
		const frame = vi.spyOn(globalThis, "requestAnimationFrame");
		recordBackgroundWrite("publishDirectoryEntry", "failure", new Error("x"));
		expect(frame).not.toHaveBeenCalled();
	});

	test("a success is a breadcrumb, not an exception", async () => {
		recordBackgroundWrite("publishDirectoryEntry", "success");
		await vi.waitFor(() =>
			expect(addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
				category: "background-write",
				message: "publishDirectoryEntry",
				level: "info",
			}),
		);
		expect(captureException).not.toHaveBeenCalled();
	});

	test("a Sentry failure is swallowed, with `unknown` for a missing code", async () => {
		captureException.mockImplementation(() => {
			throw new Error("sentry down");
		});
		recordBackgroundWrite("publishDirectoryEntry", "failure");
		// An unhandled rejection here would fail the run.
		await vi.waitFor(() =>
			expect(captureException.mock.calls[0]?.[1]).toMatchObject({
				tags: { code: "unknown" },
			}),
		);
	});

	test("a failure reaches Sentry without the document path", async () => {
		const leaky = Object.assign(
			new Error("Invalid data in document directory/abc123"),
			{ code: "invalid-argument" },
		);
		recordBackgroundWrite("publishDirectoryEntry", "failure", leaky);
		await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce());

		const [captured, context] = captureException.mock.calls[0] ?? [];
		const { message, stack, cause } = captured as Error;
		expect(JSON.stringify([message, stack, cause, context])).not.toContain(
			"abc123",
		);
		expect(context).toEqual({
			tags: {
				operation: "publishDirectoryEntry",
				outcome: "failure",
				code: "invalid-argument",
			},
		});
	});
});
