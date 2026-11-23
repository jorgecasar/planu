import { displayNameSchema } from "../domain/auth-schemas.js";
import type { SessionPort, SessionUser } from "./ports/session.js";
import type { SharingPort } from "./ports/sharing.js";

/**
 * Renames the signed-in user in the three places the name lives: the Auth
 * account first, then the `userDirectory` entry and the `userProfiles` copy,
 * which `publishDirectoryEntry` rewrites together from the updated user.
 *
 * Auth goes first because it is the source the other two are built from: if
 * it fails nothing else is written. If the publish then fails the new name is
 * already in Auth and the rejection propagates; the next sign-in republishes
 * it, so the copies catch up on their own. For an unverified account the
 * port skips the publish, exactly as at sign-in.
 *
 * Throws a `ZodError` for an empty or over-long name, before touching a port.
 */
export async function updateDisplayName(
	session: SessionPort,
	sharing: SharingPort,
	displayName: string,
): Promise<SessionUser> {
	const parsed = displayNameSchema().safeParse({ displayName });
	if (!parsed.success) throw parsed.error;

	const updated = await session.updateDisplayName(parsed.data.displayName);
	await sharing.publishDirectoryEntry(updated);
	return updated;
}
