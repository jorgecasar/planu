import { LOGIN_PATH } from "../auth/guard.js";

/** Query parameter that tells the login page the visitor came from an invitation. */
export const INVITE_PARAM = "invite";

/**
 * The link an owner sends to someone they invited.
 *
 * Public by nature: it can end up in a chat or a mail archive. So it carries
 * the event id and nothing else — no email, no uid, no title, no dates — and
 * grants nothing. Nothing reads the parameter yet: someone who already has an
 * account sees the invitation by signing in with the address it was offered
 * to (ADR 0011, ADR 0012); claiming it on sign-up is not implemented (#280).
 */
export function buildInvitationLink(origin: string, eventId: string): string {
	const url = new URL(LOGIN_PATH, origin);
	url.searchParams.set(INVITE_PARAM, eventId);
	return url.href;
}
