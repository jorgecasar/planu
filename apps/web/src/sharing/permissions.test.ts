import { expect, test } from "vitest";
import type { StoredEvent } from "../lib/types.js";
import {
	canDelete,
	canEdit,
	canLeave,
	canManageMembers,
	roleFor,
} from "./permissions.js";

const OWNER = "owner-uid";
const EDITOR = "editor-uid";
const VIEWER = "viewer-uid";
const STRANGER = "stranger-uid";

const anEvent = (): StoredEvent => ({
	id: "e1",
	title: "Concert",
	description: "",
	location: "",
	startDate: null,
	endDate: null,
	imageUrl: "",
	userId: OWNER,
	memberIds: [OWNER, EDITOR, VIEWER],
	roles: { [EDITOR]: "editor", [VIEWER]: "viewer" },
});

test("recognises every role", () => {
	expect(roleFor(anEvent(), OWNER)).toBe("owner");
	expect(roleFor(anEvent(), EDITOR)).toBe("editor");
	expect(roleFor(anEvent(), VIEWER)).toBe("viewer");
});

test("someone who is not a member has no role", () => {
	expect(roleFor(anEvent(), STRANGER)).toBeNull();
});

test("ownership wins even if the owner carried a role entry", () => {
	// This should not happen — the rules forbid it — but if a document ever
	// arrived like that, ownership has to outrank the role.
	const odd = { ...anEvent(), roles: { [OWNER]: "viewer" as const } };
	expect(roleFor(odd, OWNER)).toBe("owner");
});

test("editing: owner and editor yes, viewer and stranger no", () => {
	expect(canEdit(anEvent(), OWNER)).toBe(true);
	expect(canEdit(anEvent(), EDITOR)).toBe(true);
	expect(canEdit(anEvent(), VIEWER)).toBe(false);
	expect(canEdit(anEvent(), STRANGER)).toBe(false);
});

test("deleting and managing guests: the owner only", () => {
	for (const permission of [canDelete, canManageMembers]) {
		expect(permission(anEvent(), OWNER)).toBe(true);
		expect(permission(anEvent(), EDITOR)).toBe(false);
		expect(permission(anEvent(), VIEWER)).toBe(false);
		expect(permission(anEvent(), STRANGER)).toBe(false);
	}
});

test("leaving: any guest, never the owner", () => {
	// The owner cannot leave: it would strand the event with no administrator.
	expect(canLeave(anEvent(), OWNER)).toBe(false);
	expect(canLeave(anEvent(), EDITOR)).toBe(true);
	expect(canLeave(anEvent(), VIEWER)).toBe(true);
	expect(canLeave(anEvent(), STRANGER)).toBe(false);
});

test("an event with no membership grants nothing except to its owner", () => {
	// Events from phase 1 arrive like this until they are migrated.
	const legacy = { ...anEvent(), memberIds: [], roles: {} };
	expect(roleFor(legacy, OWNER)).toBe("owner");
	expect(canEdit(legacy, OWNER)).toBe(true);
	expect(roleFor(legacy, EDITOR)).toBeNull();
});
