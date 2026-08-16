/**
 * Who may do what to an event.
 *
 * This decides which buttons are shown. **What actually prevents anything are
 * the Firestore rules**: the point here is to avoid offering actions that are
 * going to fail, not to protect anything. Every permission in this file has a
 * matching clause in `firestore.rules` and its own denial test.
 *
 * See docs/adr/0006-sharing-with-invited-members.md.
 */

import type { EventRole, StoredEvent } from "../lib/types.js";

/** The effective role, ownership included. */
export type MemberRole = "owner" | EventRole;

/**
 * A person's role on an event, or `null` if they have no access.
 *
 * Ownership outranks the entry in `roles`. The rules keep an owner out of that
 * map, but a malformed document must never be able to demote its own owner.
 */
export function roleFor(event: StoredEvent, uid: string): MemberRole | null {
	if (event.userId === uid) return "owner";
	if (!event.memberIds?.includes(uid)) return null;

	return event.roles?.[uid] === "editor" ? "editor" : "viewer";
}

/** Changing the content: the owner and editors. */
export function canEdit(event: StoredEvent, uid: string): boolean {
	const role = roleFor(event, uid);
	return role === "owner" || role === "editor";
}

/** Deleting the event: its owner only. */
export function canDelete(event: StoredEvent, uid: string): boolean {
	return roleFor(event, uid) === "owner";
}

/** Inviting, changing roles and removing people: the owner only. */
export function canManageMembers(event: StoredEvent, uid: string): boolean {
	return roleFor(event, uid) === "owner";
}

/**
 * Removing yourself. Any guest may; the owner may not, as that would leave the
 * event with nobody to administer it.
 */
export function canLeave(event: StoredEvent, uid: string): boolean {
	const role = roleFor(event, uid);
	return role === "editor" || role === "viewer";
}
