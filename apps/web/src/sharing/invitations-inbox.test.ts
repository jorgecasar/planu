import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SessionUser } from "../application/ports/session.js";

const fakes = vi.hoisted(() => ({
	invites: [] as Record<string, unknown>[],
	acceptInvite: vi.fn(),
	declineInvite: vi.fn(),
}));

// Firestore is the boundary: the inbox gets its pending invitations and
// decides them through these two modules, so both are replaced here.
vi.mock("../firebase/collection-controller.js", () => ({
	CollectionController: class {
		get data() {
			return fakes.invites;
		}
		setQuery(): void {}
	},
}));
vi.mock("./invitations.js", () => ({
	invitesFor: () => ({}),
	acceptInvite: fakes.acceptInvite,
	declineInvite: fakes.declineInvite,
}));

import "./invitations-inbox.js";
import type { PlanuInvitationsInbox } from "./invitations-inbox.js";

const USER: SessionUser = {
	uid: "u2",
	email: "bea@example.com",
	displayName: "Bea",
	photoURL: null,
	emailVerified: true,
	provider: "password",
};

const FIRESTORE = { fake: "firestore" };

function invite(id: string, eventTitle: string, role = "viewer") {
	return {
		id,
		eventId: `event-${id}`,
		eventTitle,
		inviteeUid: "u2",
		invitedBy: "u1",
		invitedByName: "Ana",
		role,
		status: "pending",
	};
}

async function mount(): Promise<PlanuInvitationsInbox> {
	const el = document.createElement("planu-invitations-inbox");
	Object.assign(el, { firestore: FIRESTORE, user: USER });
	document.body.append(el);
	await el.updateComplete;
	return el;
}

/** The action button of the invitation whose text mentions `title`. */
function button(el: PlanuInvitationsInbox, title: string, label: string) {
	const item = [...(el.shadowRoot?.querySelectorAll("li") ?? [])].find((li) =>
		li.textContent?.includes(title),
	);
	const found = [
		...(item?.querySelectorAll<HTMLElement>("wa-button") ?? []),
	].find((b) => b.textContent?.trim() === label);
	if (!found) throw new Error(`No ${label} button for ${title}`);
	return found;
}

function alertText(el: PlanuInvitationsInbox): string {
	return (
		el.shadowRoot?.querySelector('[role="alert"]')?.textContent?.trim() ?? ""
	);
}

beforeEach(() => {
	fakes.invites = [invite("inv-1", "Cena"), invite("inv-2", "Viaje", "editor")];
	fakes.acceptInvite.mockReset().mockResolvedValue(undefined);
	fakes.declineInvite.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	document.body.replaceChildren();
});

test("muestra cada invitación pendiente con quién invita y con qué rol, sin decidir ninguna: el consentimiento es explícito", async () => {
	const el = await mount();

	expect(fakes.acceptInvite).not.toHaveBeenCalled();
	expect(fakes.declineInvite).not.toHaveBeenCalled();

	const items = [...(el.shadowRoot?.querySelectorAll("li") ?? [])];
	expect(
		items.map((li) => li.textContent?.replace(/\s+/g, " ").trim()),
	).toEqual([
		expect.stringContaining("Ana invited you to see “Cena”."),
		expect.stringContaining("Ana invited you to edit “Viaje”."),
	]);
});

test("sin invitaciones pendientes no pinta nada", async () => {
	fakes.invites = [];
	const el = await mount();

	expect(el.shadowRoot?.querySelector("li")).toBeNull();
});

test("aceptar decide esa invitación y no otra, y no la rechaza", async () => {
	const el = await mount();

	button(el, "Viaje", "Accept").click();

	expect(fakes.acceptInvite).toHaveBeenCalledTimes(1);
	expect(fakes.acceptInvite).toHaveBeenCalledWith(
		FIRESTORE,
		expect.objectContaining({
			id: "inv-2",
			eventId: "event-inv-2",
			role: "editor",
		}),
	);
	expect(fakes.declineInvite).not.toHaveBeenCalled();
});

test("rechazar decide esa invitación y no otra, y no la acepta", async () => {
	const el = await mount();

	button(el, "Cena", "Decline").click();

	expect(fakes.declineInvite).toHaveBeenCalledTimes(1);
	expect(fakes.declineInvite).toHaveBeenCalledWith(
		FIRESTORE,
		expect.objectContaining({ id: "inv-1", eventId: "event-inv-1" }),
	);
	expect(fakes.acceptInvite).not.toHaveBeenCalled();
});

test("mientras se decide, los botones de esa invitación se desactivan y mientras tanto ninguna otra invitación se decide", async () => {
	let finish: () => void = () => {};
	fakes.acceptInvite.mockReturnValue(
		new Promise<void>((resolve) => {
			finish = resolve;
		}),
	);
	const el = await mount();

	button(el, "Cena", "Accept").click();
	await el.updateComplete;
	expect(button(el, "Cena", "Accept").hasAttribute("disabled")).toBe(true);
	expect(button(el, "Cena", "Decline").hasAttribute("disabled")).toBe(true);
	expect(button(el, "Viaje", "Accept").hasAttribute("disabled")).toBe(false);

	button(el, "Viaje", "Decline").click();
	finish();
	await vi.waitFor(() =>
		expect(button(el, "Cena", "Accept").hasAttribute("disabled")).toBe(false),
	);
	expect(fakes.acceptInvite).toHaveBeenCalledTimes(1);
	expect(fakes.declineInvite).not.toHaveBeenCalled();
});

for (const [label, fake] of [
	["Accept", "acceptInvite"],
	["Decline", "declineInvite"],
] as const) {
	test(`si «${label}» falla, avisa y deja volver a intentarlo`, async () => {
		fakes[fake].mockRejectedValueOnce(new Error("permission-denied"));
		const el = await mount();

		button(el, "Cena", label).click();

		await vi.waitFor(() =>
			expect(alertText(el)).toBe("That did not work. Please try again."),
		);
		expect(button(el, "Cena", label).hasAttribute("disabled")).toBe(false);

		button(el, "Cena", label).click();
		await vi.waitFor(() => expect(alertText(el)).toBe(""));
		expect(fakes[fake]).toHaveBeenCalledTimes(2);
	});
}
