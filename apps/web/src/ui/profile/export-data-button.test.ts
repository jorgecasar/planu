import { afterEach, expect, test, vi } from "vitest";
import type { AccountExportPort } from "../../application/ports/account-export.js";
import type { SessionUser } from "../../application/ports/session.js";
import type { PlanuExportDataButton } from "./export-data-button.js";
import "./export-data-button.js";

const USER = { uid: "ana" } as SessionUser;

const SOURCE = {
	uid: "ana",
	email: null,
	displayName: null,
	profile: null,
	directoryEntry: null,
	events: [],
	sentInvites: [],
	receivedInvites: [],
};

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

async function mount(port: AccountExportPort | undefined) {
	const el = document.createElement(
		"planu-export-data-button",
	) as PlanuExportDataButton;
	Object.assign(el, { user: USER, port });
	document.body.append(el);
	await el.updateComplete;
	return el;
}

const button = (el: PlanuExportDataButton) =>
	el.shadowRoot?.querySelector("wa-button") as HTMLElement;

test("reads the account of the signed-in person and offers the file as a download", async () => {
	const read = vi.fn(async () => SOURCE);
	const click = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(() => {});
	const el = await mount({ read });

	button(el).click();
	await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));

	expect(read).toHaveBeenCalledExactlyOnceWith("ana");
});

test("a failing read shows a notice and no download starts", async () => {
	const click = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(() => {});
	const el = await mount({
		read: async () => {
			throw new Error("permission-denied");
		},
	});

	button(el).click();
	await vi.waitFor(() =>
		expect(el.shadowRoot?.querySelector("[role=alert]")).not.toBeNull(),
	);

	expect(click).not.toHaveBeenCalled();
});
