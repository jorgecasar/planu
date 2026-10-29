import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createVerifiedAccount, newEmail, signIn } from "./verified-account.js";

/**
 * Unique titles per run: the emulator keeps data between runs, and looking up a
 * fixed title ended up matching an event from an earlier run instead of the one
 * just created.
 */
const newTitle = (base: string) =>
	`${base} ${Math.random().toString(36).slice(2, 7)}`;

async function createEvent(page: Page, title: string): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Description").fill(`About ${title}`);
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

interface EmulatorDocument {
	name: string;
	fields: {
		title: { stringValue: string };
		userId: { stringValue: string };
		memberIds: { arrayValue: { values: { stringValue: string }[] } };
	};
}

const FIRESTORE_EMULATOR =
	"http://127.0.0.1:8181/v1/projects/planu-app/databases/planu/documents";

/**
 * Promotes the guest of the given event to editor, bypassing the rules with the
 * emulator's admin token.
 */
async function promoteToEditor(page: Page, title: string): Promise<void> {
	const admin = { Authorization: "Bearer owner" };

	/**
	 * The event, once the invitation the interface just made is visible here.
	 *
	 * A filtered query rather than listing the collection: the emulator keeps
	 * every event from every run, and a plain GET paginates, so the one just
	 * created eventually stopped being on the first page.
	 */
	const findInvited = async (): Promise<EmulatorDocument | undefined> => {
		const response = await page.request.post(`${FIRESTORE_EMULATOR}:runQuery`, {
			headers: admin,
			data: {
				structuredQuery: {
					from: [{ collectionId: "events" }],
					where: {
						fieldFilter: {
							field: { fieldPath: "title" },
							op: "EQUAL",
							value: { stringValue: title },
						},
					},
				},
			},
		});
		const rows = (await response.json()) as { document?: EmulatorDocument }[];

		return rows
			.map((row) => row.document)
			.find(
				(candidate): candidate is EmulatorDocument =>
					candidate !== undefined &&
					candidate.fields.memberIds.arrayValue.values.length > 1,
			);
	};

	// Polled rather than read once: the interface has already reported the
	// invitation saved, but this reads through a different path and the two do
	// not have to land in the same instant. Reading once made the test flaky
	// under parallel runs.
	await expect
		.poll(async () => Boolean(await findInvited()), {
			message: `event ${title} never showed an invited guest`,
		})
		.toBe(true);

	const event = await findInvited();
	if (!event) return;

	const owner = event.fields.userId.stringValue;
	const guest = event.fields.memberIds.arrayValue.values
		.map((value) => value.stringValue)
		.find((uid) => uid !== owner);
	expect(guest, `event ${title} has no guests`).toBeDefined();

	// The name the emulator returns is the resource's full path.
	const path = event.name.split("/documents/")[1];
	const patched = await page.request.patch(
		`${FIRESTORE_EMULATOR}/${path}?updateMask.fieldPaths=roles`,
		{
			headers: admin,
			data: {
				fields: {
					roles: {
						mapValue: {
							fields: { [guest as string]: { stringValue: "editor" } },
						},
					},
				},
			},
		},
	);
	expect(patched.ok()).toBe(true);
}

/**
 * Takes the offer. Membership is consensual now, so an invitation on its own
 * changes nothing for the recipient until they act on it.
 */
async function acceptInvitation(guestPage: Page): Promise<void> {
	await guestPage.reload();
	await guestPage.getByRole("button", { name: "Accept" }).click();
}

/** A second person, in their own context: separate session and storage. */
async function openSecondSession(
	browser: Browser,
	email: string,
): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await signIn(page, email);
	return page;
}

test("a viewer guest sees the event but cannot touch it", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);

	// The guest signs in first: doing so publishes them to the directory, which
	// is what makes them findable by email.
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);

	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();

	// Nothing reaches the guest until they accept: that is the whole point of
	// the consent gate.
	await guestPage.reload();
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toHaveCount(0);
	await guestPage.getByRole("button", { name: "Accept" }).click();

	// The guest sees it, knows it is not theirs, and is not offered a way to
	// destroy it.
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toBeVisible();
	await expect(guestPage.getByText("Shared: view only")).toBeVisible();
	await expect(guestPage.getByRole("button", { name: "Delete" })).toHaveCount(
		0,
	);
	await expect(guestPage.getByRole("button", { name: "Edit" })).toHaveCount(0);
	await expect(guestPage.getByRole("button", { name: "Share" })).toHaveCount(0);

	const results = await new AxeBuilder({ page: guestPage }).analyze();
	expect(results.violations).toEqual([]);

	await guestPage.context().close();
});

test("promoted to editor, can edit but still cannot delete", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();

	await acceptInvitation(guestPage);

	// The promotion goes through the emulator API rather than the interface's
	// dropdown. What this test checks is **what an editor may do**; that the
	// dropdown works is already covered by the dialog test above, and fighting
	// the listbox here would only add flakiness to a check about something
	// else.
	await promoteToEditor(page, title_);

	await guestPage.reload();
	await expect(guestPage.getByText("Shared: you can edit")).toBeVisible();
	await expect(guestPage.getByRole("button", { name: "Edit" })).toBeVisible();
	await expect(guestPage.getByRole("button", { name: "Delete" })).toHaveCount(
		0,
	);

	await guestPage.context().close();
});

test("a guest can leave the event", async ({ page, browser }) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();

	await acceptInvitation(guestPage);
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toBeVisible();

	// Leaving now asks for confirmation, like deleting does. The dialog is
	// located by its body text: both it and the card carry a "Leave" button.
	await guestPage.getByRole("button", { name: "Leave" }).click();
	await expect(guestPage.getByText("You will stop seeing")).toBeVisible();
	await guestPage
		.getByRole("button", { name: "Leave", exact: true })
		.last()
		.click();
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toHaveCount(0);

	// And it still exists for its owner: leaving deletes nothing.
	await expect(
		page.getByRole("heading", { name: title_, exact: true }),
	).toBeVisible();

	await guestPage.context().close();
});

test("cannot invite someone without an account", async ({ page }) => {
	const owner = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await signIn(page, owner);
	await createEvent(page, title_);

	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill("nadie@example.com");
	await page.getByRole("button", { name: "Invite", exact: true }).click();

	await expect(
		page.getByText("Nobody with that email has an account yet.", {
			exact: false,
		}),
	).toBeVisible();
});

test("the share dialog has no accessibility violations", async ({ page }) => {
	const owner = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await signIn(page, owner);
	await createEvent(page, title_);

	await page.getByRole("button", { name: "Share" }).click();
	await expect(page.getByLabel("Invite by email")).toBeVisible();

	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

test("the inbox filter separates your own from the shared ones", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const sharedTitle = newTitle("Compartido");
	const ownTitle = newTitle("Propio");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, sharedTitle);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();
	await page.keyboard.press("Escape");

	// The guest has one of their own and one they accepted.
	await acceptInvitation(guestPage);
	await createEvent(guestPage, ownTitle);
	await expect(
		guestPage.getByRole("heading", { name: sharedTitle, exact: true }),
	).toBeVisible();

	await guestPage.getByRole("radio", { name: "Mine" }).click();
	await expect(
		guestPage.getByRole("heading", { name: ownTitle, exact: true }),
	).toBeVisible();
	await expect(
		guestPage.getByRole("heading", { name: sharedTitle, exact: true }),
	).toHaveCount(0);

	await guestPage.getByRole("radio", { name: "Shared with me" }).click();
	await expect(
		guestPage.getByRole("heading", { name: sharedTitle, exact: true }),
	).toBeVisible();
	await expect(
		guestPage.getByRole("heading", { name: ownTitle, exact: true }),
	).toHaveCount(0);

	const results = await new AxeBuilder({ page: guestPage }).analyze();
	expect(results.violations).toEqual([]);

	await guestPage.context().close();
});

test("an invitation changes nothing until it is accepted or declined", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();

	// The offer is visible; the event is not. This is the defect the consent
	// model exists to fix: before it, anyone knowing your email could put
	// arbitrary content in your listing, and you could not even delete it.
	await guestPage.reload();
	await expect(guestPage.getByText("invited you to see")).toBeVisible();
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toHaveCount(0);

	// Declining leaves no trace, and the event stays with its owner.
	await guestPage.getByRole("button", { name: "Decline" }).click();
	await expect(guestPage.getByText("invited you to see")).toHaveCount(0);
	await expect(
		guestPage.getByRole("heading", { name: title_, exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("heading", { name: title_, exact: true }),
	).toBeVisible();

	const results = await new AxeBuilder({ page: guestPage }).analyze();
	expect(results.violations).toEqual([]);

	await guestPage.context().close();
});

test("the share dialog lists who has access and who is still pending", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);
	await page.getByRole("button", { name: "Share" }).click();

	// You are in the list, as owner, before anyone else is. Exact, because the
	// leave dialog's copy also contains the word.
	await expect(page.getByText("Owner", { exact: true })).toBeVisible();

	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Invitation sent.")).toBeVisible();

	// The offer shows up in the list straight away. This went unnoticed for a
	// while: reset() was called on a form Lit had already replaced, it threw,
	// and the reload right after it never ran — so the list stayed empty and
	// the owner had no way to tell the invitation had been made.
	await expect(page.getByText("Pending", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Invite by email")).toHaveValue("");

	// Once accepted, the same row stops being pending.
	await acceptInvitation(guestPage);
	await page.reload();
	await page.getByRole("button", { name: "Share" }).click();
	await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);

	await guestPage.context().close();
});

test("the role of a pending invitation can still be changed", async ({
	page,
	browser,
}) => {
	const owner = newEmail();
	const guest = newEmail();
	const title_ = newTitle("Evento");
	await createVerifiedAccount(page, owner);
	await createVerifiedAccount(page, guest);
	const guestPage = await openSecondSession(browser, guest);

	await signIn(page, owner);
	await createEvent(page, title_);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(guest);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByText("Pending", { exact: true })).toBeVisible();

	// Nobody has decided anything yet, so the offer is still the owner's to
	// adjust — it used to be frozen the moment it was sent.
	await page.getByRole("button", { name: /Access for/ }).click();
	await page.getByRole("menuitemcheckbox", { name: "Editor" }).click();

	// What the guest accepts is the role as it stands now, not as it was sent.
	await acceptInvitation(guestPage);
	await expect(guestPage.getByText("Shared: you can edit")).toBeVisible();

	await guestPage.context().close();
});
