/**
 * Why the login page is being shown, when it isn't the obvious reason: the
 * account was just deleted, or the session ended while deleting it (#154).
 */
export type LoginNotice = "account-deleted" | "deletion-interrupted";

const KEY = "planuLoginNotice";

/**
 * The history state that carries a notice to the login page.
 *
 * History state, not storage: it belongs to one history entry, so nothing
 * persistent is left behind for another visit to pick up.
 */
export function loginNoticeState(
	notice: LoginNotice | undefined,
): Record<string, string> {
	return notice ? { [KEY]: notice } : {};
}

/**
 * Reads the notice and removes it from the current entry.
 *
 * History state survives a reload, so leaving it in place would show the
 * notice again on every reload. Taking it is what makes it one-shot.
 */
export function takeLoginNotice(
	history: Pick<History, "state" | "replaceState">,
): LoginNotice | undefined {
	const state: unknown = history.state;
	if (typeof state !== "object" || state === null) return undefined;

	const { [KEY]: notice, ...rest } = state as Record<string, unknown>;
	if (notice !== "account-deleted" && notice !== "deletion-interrupted") {
		return undefined;
	}
	history.replaceState(rest, "");
	return notice;
}
