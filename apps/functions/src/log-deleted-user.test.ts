import { describe, expect, it, vi } from "vitest";
import { logDeletedUser } from "./log-deleted-user.js";

describe("logDeletedUser", () => {
	it("logs the uid of the deleted account", () => {
		const log = vi.fn();

		logDeletedUser("abc123", log);

		expect(log).toHaveBeenCalledExactlyOnceWith("account deleted", {
			uid: "abc123",
		});
	});

	it("refuses an empty uid instead of logging a blank account", () => {
		const log = vi.fn();

		expect(() => logDeletedUser("", log)).toThrow(/needs the uid/);
		expect(log).not.toHaveBeenCalled();
	});
});
