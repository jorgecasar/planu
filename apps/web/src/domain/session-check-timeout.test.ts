import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { watchSessionCheckTimeout } from "./session-check-timeout.js";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test("fires once the timeout elapses", () => {
	const onTimeout = vi.fn();
	watchSessionCheckTimeout(1000, onTimeout);

	vi.advanceTimersByTime(999);
	expect(onTimeout).not.toHaveBeenCalled();

	vi.advanceTimersByTime(1);
	expect(onTimeout).toHaveBeenCalledTimes(1);
});

test("cancelling before it elapses stops it from firing", () => {
	const onTimeout = vi.fn();
	const cancel = watchSessionCheckTimeout(1000, onTimeout);

	cancel();
	vi.advanceTimersByTime(10_000);
	expect(onTimeout).not.toHaveBeenCalled();
});

test("cancelling after it already fired is a no-op, not an error", () => {
	const onTimeout = vi.fn();
	const cancel = watchSessionCheckTimeout(1000, onTimeout);

	vi.advanceTimersByTime(1000);
	expect(onTimeout).toHaveBeenCalledTimes(1);

	expect(() => cancel()).not.toThrow();
	expect(onTimeout).toHaveBeenCalledTimes(1);
});
