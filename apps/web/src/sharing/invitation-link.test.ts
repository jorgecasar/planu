import { expect, test } from "vitest";
import { buildInvitationLink } from "./invitation-link.js";

test("the link points at the login page and carries only the event id", () => {
	const link = new URL(buildInvitationLink("https://planu.test", "abc123"));

	expect(link.origin).toBe("https://planu.test");
	expect(link.pathname).toBe("/app/login");
	expect([...link.searchParams.keys()]).toEqual(["invite"]);
	expect(link.searchParams.get("invite")).toBe("abc123");
	expect(link.hash).toBe("");
});

test("an id with reserved characters cannot add parameters", () => {
	const link = new URL(
		buildInvitationLink("https://planu.test", "a&email=x@y.z"),
	);

	expect([...link.searchParams.keys()]).toEqual(["invite"]);
	expect(link.searchParams.get("invite")).toBe("a&email=x@y.z");
});
