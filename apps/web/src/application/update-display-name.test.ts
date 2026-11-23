import { expect, test, vi } from "vitest";
import { ZodError } from "zod";
import { SessionError } from "../domain/session-error.js";
import type { SessionPort, SessionUser } from "./ports/session.js";
import type { SharingPort } from "./ports/sharing.js";
import { updateDisplayName } from "./update-display-name.js";

const USER: SessionUser = {
	uid: "u1",
	email: "ana@example.com",
	displayName: "Ana",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

function fakes() {
	const renamed = { ...USER, displayName: "Ana Maria" };
	const session = {
		updateDisplayName: vi.fn().mockResolvedValue(renamed),
	} as unknown as SessionPort;
	const sharing = {
		publishDirectoryEntry: vi.fn().mockResolvedValue(undefined),
	} as unknown as SharingPort;
	return { session, sharing, renamed };
}

test("saves the trimmed name in Auth, then republishes the directory copies with it", async () => {
	const { session, sharing, renamed } = fakes();

	const result = await updateDisplayName(session, sharing, "  Ana Maria ");

	expect(session.updateDisplayName).toHaveBeenCalledWith("Ana Maria");
	expect(sharing.publishDirectoryEntry).toHaveBeenCalledWith(renamed);
	expect(result).toBe(renamed);
});

test("an empty or too long name is refused before touching any port", async () => {
	const { session, sharing } = fakes();

	await expect(updateDisplayName(session, sharing, "   ")).rejects.toThrow(
		ZodError,
	);
	await expect(
		updateDisplayName(session, sharing, "x".repeat(201)),
	).rejects.toThrow(ZodError);
	expect(session.updateDisplayName).not.toHaveBeenCalled();
	expect(sharing.publishDirectoryEntry).not.toHaveBeenCalled();
});

test("a failed Auth update publishes nothing and propagates the SessionError", async () => {
	const { session, sharing } = fakes();
	vi.mocked(session.updateDisplayName).mockRejectedValue(
		new SessionError("requires-recent-login"),
	);

	await expect(
		updateDisplayName(session, sharing, "Ana Maria"),
	).rejects.toMatchObject({ code: "requires-recent-login" });
	expect(sharing.publishDirectoryEntry).not.toHaveBeenCalled();
});
