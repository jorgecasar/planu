import { expect, test, vi } from "vitest";
import type { AccountExportSource } from "../domain/account-export.js";
import { exportAccount } from "./export-account.js";
import type { AccountExportPort } from "./ports/account-export.js";

const SOURCE: AccountExportSource = {
	uid: "me",
	email: "me@example.com",
	displayName: "Me",
	profile: null,
	directoryEntry: null,
	events: [{ id: "e1", isOwner: true, fields: { title: "Mine" } }],
	sentInvites: [],
	receivedInvites: [],
};

const NOW = new Date("2026-11-23T10:00:00.000Z");

test("it reads only the signed-in account and returns a JSON file", async () => {
	const read = vi.fn(async () => SOURCE);
	const port: AccountExportPort = { read };

	const file = await exportAccount(port, "me", NOW);

	expect(read).toHaveBeenCalledExactlyOnceWith("me");
	expect(file.fileName).toBe("planu-export-2026-11-23.json");
	expect(file.mimeType).toBe("application/json");
	const parsed = JSON.parse(file.content);
	expect(parsed.account.uid).toBe("me");
	expect(parsed.events).toEqual([{ id: "e1", data: { title: "Mine" } }]);
});

test("a failing read is not hidden behind a half-empty file", async () => {
	const port: AccountExportPort = {
		read: async () => {
			throw new Error("permission-denied");
		},
	};

	await expect(exportAccount(port, "me", NOW)).rejects.toThrow(
		"permission-denied",
	);
});
