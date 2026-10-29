import { changeEmailSchema } from "../auth/schemas.js";
import { SessionError } from "../domain/session-error.js";
import type { SessionPort, SessionUser } from "./ports/session.js";

/**
 * Validates the new address and asks the provider to move the account to
 * it. Nothing changes until the link mailed to `newEmail` is clicked — see
 * `SessionPort.changeEmail()` — so this resolving means "link sent", not
 * "email changed".
 *
 * Same shape as `signUp()`: a `ZodError` for invalid input, before touching
 * the port; a `SessionError` for anything the provider refuses.
 *
 * Checks verification on a fresh read first, not on `user`: that snapshot
 * never learns about a verification done on another device. An account
 * that is in fact verified has a directory entry under its current
 * address, which only a token carrying that address can delete — moving
 * it to another one would orphan the entry for good. So it's refused with
 * `"already-verified"` instead.
 *
 * Known gap: the link sent here can't be revoked. If the account then
 * verifies its current address A and publishes `userDirectory/{hash(A)}`,
 * clicking the old link later still moves the account to the new address,
 * and from then on no token carries A, so the client can no longer delete
 * that entry — not even when deleting the account. The fix is server-side,
 * to be decided together with the `eventInvites` cleanup on account
 * deletion.
 */
export async function changeEmail(
	session: SessionPort,
	user: SessionUser,
	newEmail: string,
): Promise<string> {
	const parsed = changeEmailSchema(user.email).safeParse({
		email: newEmail.trim(),
	});
	if (!parsed.success) throw parsed.error;

	const current = await session.refreshEmailVerification();
	if (current?.emailVerified) throw new SessionError("already-verified");

	await session.changeEmail(parsed.data.email);
	return parsed.data.email;
}
