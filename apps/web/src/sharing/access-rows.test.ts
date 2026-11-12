import { render } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";
import type { Person } from "./access-list.js";
import { renderOwner, renderPerson } from "./access-rows.js";

const BEA: Person = {
	key: "invite-1",
	uid: "bea-uid",
	role: "editor",
	name: "Bea",
	email: "bea@example.com",
	photoURL: "bea.png",
	pending: true,
};

afterEach(() => {
	document.body.replaceChildren();
});

function mount(template: unknown) {
	const list = document.body.appendChild(document.createElement("ul"));
	render(template, list);
	return list;
}

const text = (list: Element, selector: string) =>
	list.querySelector(selector)?.textContent?.trim();

test("the owner reads as the owner, with their address", () => {
	const list = mount(
		renderOwner({
			displayName: "",
			email: "ana@example.com",
			photoURL: null,
		} as SessionUser),
	);

	expect(text(list, ".name")).toBe("You");
	expect(text(list, ".detail")).toBe("ana@example.com");
	expect(text(list, ".owner-role")).toBe("Owner");
});

test("a pending offer shows its address, a badge and a cancel action", () => {
	const list = mount(renderPerson(BEA, false, () => {}));

	expect(text(list, ".detail")).toBe("bea@example.com");
	expect(text(list, "wa-badge")).toBe("Pending");
	expect(text(list, "[value=remove]")).toBe("Cancel invitation");
	const checked = list.querySelectorAll("[checked]");
	expect([...checked].map((item) => item.getAttribute("value"))).toEqual([
		"editor",
	]);
});

test("a member shows no address and is removed, not cancelled", () => {
	const member = { ...BEA, key: "bea-uid", pending: false, role: "viewer" };
	const list = mount(renderPerson(member as Person, true, () => {}));

	expect(list.querySelector(".detail")).toBeNull();
	expect(list.querySelector("wa-badge")).toBeNull();
	expect(text(list, "[value=remove]")).toBe("Remove access");
	expect(text(list, ".sr-only")).toBe("Access for Bea");
	const trigger = list.querySelector("[slot=trigger]");
	expect(trigger?.hasAttribute("disabled")).toBe(true);
});

test("picking from the menu hands over the person and the event", () => {
	const onAction = vi.fn();
	const list = mount(renderPerson(BEA, false, onAction));
	const pick = new CustomEvent("wa-select", {
		detail: { item: { value: "x" } },
	});

	list.querySelector("wa-dropdown")?.dispatchEvent(pick);

	expect(onAction).toHaveBeenCalledWith(BEA, pick);
});
