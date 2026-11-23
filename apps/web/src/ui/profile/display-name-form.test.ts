import { afterEach, expect, test, vi } from "vitest";
import type {
	SessionPort,
	SessionUser,
} from "../../application/ports/session.js";
import type { SharingPort } from "../../application/ports/sharing.js";
import "./display-name-form.js";

const USER = {
	uid: "u1",
	email: "ana@example.com",
	displayName: "Ana",
} as SessionUser;

afterEach(() => {
	document.body.replaceChildren();
});

async function mount(session: Partial<SessionPort>, sharing: object = {}) {
	const el = document.createElement("planu-display-name-form");
	Object.assign(el, { user: USER, session, sharing });
	document.body.append(el);
	await el.updateComplete;
	return el;
}

async function submit(
	el: HTMLElementTagNameMap["planu-display-name-form"],
	name: string,
) {
	const input = el.querySelector<HTMLInputElement>("wa-input");
	if (!input) throw new Error("No display name field");
	input.value = name;
	input.dispatchEvent(new Event("input"));
	await el.updateComplete;
	el.querySelector("form")?.requestSubmit();
}

test("saves through both ports, announces it and fires display-name-updated", async () => {
	const renamed = { ...USER, displayName: "Ana Maria" };
	const updateDisplayName = vi.fn().mockResolvedValue(renamed);
	const publishDirectoryEntry = vi.fn().mockResolvedValue(undefined);
	const el = await mount({ updateDisplayName }, {
		publishDirectoryEntry,
	} as Partial<SharingPort>);
	const updated = vi.fn();
	el.addEventListener("display-name-updated", updated);

	await submit(el, "Ana Maria");

	await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
	expect(updateDisplayName).toHaveBeenCalledWith("Ana Maria");
	expect(publishDirectoryEntry).toHaveBeenCalledWith(renamed);
	const event: CustomEvent<SessionUser> = updated.mock.calls[0]?.[0];
	expect(event.detail).toBe(renamed);
	await el.updateComplete;
	expect(el.querySelector('[aria-live="polite"]')?.textContent).toBe(
		"Name saved.",
	);
});

test("an empty name shows the validation message and calls nothing", async () => {
	const updateDisplayName = vi.fn();
	const el = await mount({ updateDisplayName });

	await submit(el, "   ");

	await vi.waitFor(() =>
		expect(
			el.querySelector('[aria-live="assertive"]')?.textContent?.trim(),
		).not.toBe(""),
	);
	expect(updateDisplayName).not.toHaveBeenCalled();
});
