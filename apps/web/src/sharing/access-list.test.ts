import { expect, test } from "vitest";
import type { PublicProfile } from "../application/ports/sharing.js";
import type { StoredEvent } from "../lib/types.js";
import { toPeople } from "./access-list.js";

const EVENT = {
	id: "event-1",
	userId: "owner-uid",
	roles: { "bea-uid": "editor" },
} as unknown as StoredEvent;

const INVITE = {
	id: "invite-1",
	eventId: EVENT.id,
	inviteeUid: "dan-uid",
	inviteeEmail: "dan@example.com",
	role: "editor",
} as const;

const PROFILES = new Map<string, PublicProfile>([
	["bea-uid", { displayName: "Bea", photoURL: "bea.png" }],
	["dan-uid", { displayName: "", photoURL: "dan.png" }],
]);

/** One row as `[key, uid, role, name, email, photoURL, pending]`. */
const row = (person: ReturnType<typeof toPeople>[number]) => [
	person.key,
	person.uid,
	person.role,
	person.name,
	person.email,
	person.photoURL,
	person.pending,
];

test("members come first, by name, without their address", () => {
	const people = toPeople(EVENT, ["bea-uid", "carl-uid"], [], PROFILES);

	expect(people.map(row)).toEqual([
		["bea-uid", "bea-uid", "editor", "Bea", "", "bea.png", false],
		["carl-uid", "carl-uid", "viewer", "Guest", "", "", false],
	]);
});

test("a pending offer is keyed by invitation and shows the typed address", () => {
	const people = toPeople(EVENT, ["carl-uid"], [INVITE], PROFILES);

	expect(people.map(row)).toEqual([
		["carl-uid", "carl-uid", "viewer", "Guest", "", "", false],
		[
			"invite-1",
			"dan-uid",
			"editor",
			"Guest",
			"dan@example.com",
			"dan.png",
			true,
		],
	]);
});
