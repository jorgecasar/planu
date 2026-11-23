import { expect, test } from "vitest";
import {
	ACCOUNT_EXPORT_FORMAT,
	type AccountExportSource,
	buildAccountExport,
} from "./account-export.js";

const NOW = new Date("2026-11-23T10:00:00.000Z");

const source = (
	over: Partial<AccountExportSource> = {},
): AccountExportSource => ({
	uid: "me",
	email: "me@example.com",
	displayName: "Me",
	profile: { displayName: "Me", photoURL: "" },
	directoryEntry: { displayName: "Me", photoURL: "" },
	events: [],
	sentInvites: [],
	receivedInvites: [],
	...over,
});

test("the export names its format and when it was made", () => {
	const out = buildAccountExport(source(), NOW);

	expect(out.format).toBe(ACCOUNT_EXPORT_FORMAT);
	expect(out.exportedAt).toBe("2026-11-23T10:00:00.000Z");
	expect(out.account).toEqual({
		uid: "me",
		email: "me@example.com",
		displayName: "Me",
	});
});

test("it carries the profile and the directory entry of the person", () => {
	const out = buildAccountExport(source(), NOW);

	expect(out.profile).toEqual({ displayName: "Me", photoURL: "" });
	expect(out.directoryEntry).toEqual({ displayName: "Me", photoURL: "" });
});

test("only the events the person owns are exported, not the ones shared with them", () => {
	const out = buildAccountExport(
		source({
			events: [
				{ id: "mine", isOwner: true, fields: { title: "Mine" } },
				{ id: "theirs", isOwner: false, fields: { title: "Someone else's" } },
			],
		}),
		NOW,
	);

	expect(out.events).toEqual([{ id: "mine", data: { title: "Mine" } }]);
	expect(JSON.stringify(out)).not.toContain("Someone else's");
});

test("invitations keep the event and the role and drop the other person's data", () => {
	const out = buildAccountExport(
		source({
			sentInvites: [
				{
					id: "s1",
					eventId: "e1",
					role: "viewer",
					inviteeEmail: "friend@example.com",
					inviteeUid: "friend-uid",
				},
			],
			receivedInvites: [
				{
					id: "r1",
					eventId: "e2",
					role: "editor",
					invitedByName: "Ana Owner",
					eventTitle: "Ana's party",
				},
			],
		}),
		NOW,
	);

	expect(out.invitations.sent).toEqual([
		{ id: "s1", eventId: "e1", role: "viewer" },
	]);
	expect(out.invitations.received).toEqual([
		{ id: "r1", eventId: "e2", role: "editor" },
	]);
	const text = JSON.stringify(out);
	for (const other of [
		"friend@example.com",
		"friend-uid",
		"Ana Owner",
		"Ana's party",
	]) {
		expect(text).not.toContain(other);
	}
});

test("a person with nothing still gets a complete, empty file", () => {
	const out = buildAccountExport(
		source({ profile: null, directoryEntry: null }),
		NOW,
	);

	expect(out.events).toEqual([]);
	expect(out.invitations).toEqual({ sent: [], received: [] });
	expect(out.profile).toBeNull();
});
