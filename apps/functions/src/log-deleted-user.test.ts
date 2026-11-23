import { describe, expect, it, vi } from "vitest";
import { hashUid, logDeletedUser } from "./log-deleted-user.js";

describe("logDeletedUser", () => {
	it("logs a one-way hash of the uid, never the uid itself", () => {
		const log = vi.fn();

		logDeletedUser("abc123", log);

		expect(log).toHaveBeenCalledOnce();
		expect(JSON.stringify(log.mock.calls)).not.toContain("abc123");
		expect(log.mock.calls[0]?.[1]).toEqual({ uidHash: hashUid("abc123") });
	});

	it("hashes deterministically so a failed sweep can be correlated", () => {
		expect(hashUid("abc123")).toBe(hashUid("abc123"));
		expect(hashUid("abc123")).not.toBe(hashUid("abc124"));
		expect(hashUid("abc123")).toMatch(/^[0-9a-f]{16}$/);
	});

	it("refuses an empty uid instead of logging a blank account", () => {
		const log = vi.fn();

		expect(() => logDeletedUser("", log)).toThrow(/needs the uid/);
		expect(log).not.toHaveBeenCalled();
	});
});
