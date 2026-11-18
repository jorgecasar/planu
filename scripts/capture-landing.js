/**
 * Captures the landing screenshots of the app, per language (#271, R4): the
 * hero list, the export menu open and a phone crop of the hero.
 *
 * Needs `npm run emulators`, `npm run seed:landing` and `npm run dev` running.
 * For each language it signs in as that language's demo account (the form is
 * always read in English), keeps the session with its IndexedDB, reopens the
 * app in the language to capture, answers every cover request with the
 * synthetic SVG of `landing-covers.js` instead of the network, and writes
 * `apps/web/public/assets/landing/{hero,export,hero-mobile}-<lang>.webp`.
 *
 * Chromium cannot encode webp from `screenshot`, so the PNG goes through a
 * canvas in the page: no image dependency is added. Each file must stay under
 * 60 KB, or the run fails and says which one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { coverNameOf, coverSvg } from "./landing-covers.js";
import { emailOf, guestEmailOf, PASSWORD } from "./landing-demo.js";

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3000";
const OUT = "apps/web/public/assets/landing";
const SIZE = { width: 1200, height: 675 };
const PHONE = { width: 390, height: 640 };
const SHARE = { width: 544, height: 600 };
const MAX_BYTES = 60 * 1024;
const LANGUAGES = [
	["en", "en-US"],
	["es", "es-ES"],
];

const browser = await chromium.launch();
const withCovers = async (context) => {
	await context.route("https://firebasestorage.googleapis.com/**", (route) => {
		const name = coverNameOf(route.request().url());
		return name
			? route.fulfill({ contentType: "image/svg+xml", body: coverSvg(name) })
			: route.abort();
	});
};

/** Signs in with the English form and returns the saved session. */
async function signIn(email) {
	const context = await browser.newContext({ locale: "en-US", viewport: SIZE });
	await withCovers(context);
	const page = await context.newPage();
	await page.goto(`${BASE}/app/login`);
	// Both tab panels carry the labels; the sign-in one comes first.
	await page.getByLabel("Email").first().fill(email);
	await page.getByLabel("Password", { exact: true }).first().fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(`${BASE}/app`);
	// Signing in publishes the user to the directory in the background; leaving
	// at once left the guest unfindable by email.
	await page.waitForTimeout(3000);
	const state = await context.storageState({ indexedDB: true });
	await context.close();
	return state;
}

/** Opens the list of a signed-in session, with covers and fonts painted. */
async function openList(state, locale, viewport) {
	const context = await browser.newContext({
		locale,
		viewport,
		storageState: state,
	});
	await withCovers(context);
	const page = await context.newPage();
	await page.goto(`${BASE}/app`);
	await page.locator("planu-event-card").first().waitFor();
	// The covers live in shadow roots, out of `document.images`; Playwright's
	// CSS engine pierces them. No `networkidle`: Vite and Firestore keep sockets open.
	const covers = page.locator("planu-event-card img");
	await covers.first().waitFor();
	await page.waitForFunction(async () => {
		await document.fonts.ready;
		return true;
	});
	for (const cover of await covers.all()) {
		await cover.evaluate((img) => img.decode());
	}
	return { context, page };
}

/** Writes the screenshot as a webp and fails if it is over the size limit. */
async function save(page, name, clip) {
	const png = await page.screenshot({ type: "png", clip });
	const webp = await page.evaluate(async (b64) => {
		const bitmap = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${b64}`)).blob(),
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		canvas.getContext("2d").drawImage(bitmap, 0, 0);
		const blob = await canvas.convertToBlob({
			type: "image/webp",
			quality: 0.8,
		});
		return [...new Uint8Array(await blob.arrayBuffer())];
	}, png.toString("base64"));
	const bytes = Buffer.from(webp);
	if (bytes.length > MAX_BYTES) {
		throw new Error(`${name}.webp is ${bytes.length} bytes, over ${MAX_BYTES}`);
	}
	writeFileSync(`${OUT}/${name}.webp`, bytes);
	console.log(`${name}.webp ${bytes.length} bytes`);
}

/**
 * Invites the demo guest to the owner's first event and has them accept, so the
 * share dialog has a real row. Done in English, whatever the language being
 * captured: the form is only read here, not shown. Needs a fresh seed: a guest
 * who is already in the event makes the invitation fail.
 */
async function inviteGuest(ownerState, lang) {
	const guestState = await signIn(guestEmailOf(lang));
	const owner = await openList(ownerState, "en-US", SIZE);
	await openShare(owner.page);
	await owner.page.getByLabel("Invite by email").fill(guestEmailOf(lang));
	await owner.page.getByRole("button", { name: "Invite", exact: true }).click();
	await owner.page.getByText("Invitation sent.").waitFor();
	await owner.context.close();
	// No list to wait for yet: the invitation is what the guest sees first.
	const context = await browser.newContext({
		locale: "en-US",
		viewport: SIZE,
		storageState: guestState,
	});
	await withCovers(context);
	const page = await context.newPage();
	await page.goto(`${BASE}/app`);
	await page.getByRole("button", { name: "Accept" }).click();
	await page.locator("planu-event-card").first().waitFor();
	await context.close();
}

/** Opens the share dialog of the first card, in any language. */
async function openShare(page) {
	await page
		.locator("planu-event-card")
		.first()
		.locator('wa-button[slot="trigger"]')
		.click();
	await page.locator('wa-dropdown-item[value="share"]').first().click();
	await page.getByRole("dialog").waitFor();
}

/** The hero list, the export menu open and the phone crop of the hero. */
async function capture(state, [lang, locale]) {
	const desktop = await openList(state, locale, SIZE);
	await save(desktop.page, `hero-${lang}`);
	// The menu hangs below its trigger: a crop that holds both, and the cards
	// behind it for context.
	await desktop.page
		.getByRole("button", { name: /^(Export calendar|Exportar el calendario)$/ })
		.click();
	await desktop.page.getByRole("menu").waitFor();
	// The menu fades in with the Web Animations API; a shot taken mid-fade
	// shows the item half transparent.
	await desktop.page.evaluate(() =>
		Promise.all(document.getAnimations().map((a) => a.finished)),
	);
	// The item is painted a beat after the animation reports done.
	await desktop.page.waitForTimeout(600);
	await save(desktop.page, `export-${lang}`, {
		x: 0,
		y: 90,
		width: SIZE.width,
		height: 420,
	});
	await desktop.context.close();
	const share = await openList(state, locale, SIZE);
	await openShare(share.page);
	await share.page.waitForTimeout(600);
	await share.page.evaluate(() =>
		Promise.all(document.getAnimations().map((a) => a.finished)),
	);
	const box = await share.page.getByRole("dialog").boundingBox();
	if (!box) throw new Error("the share dialog has no box");
	// A fixed size, centred on the dialog: its height changes with the language
	// and the page declares one width and height for both.
	await save(share.page, `share-${lang}`, {
		x: Math.max(0, box.x + box.width / 2 - SHARE.width / 2),
		y: Math.max(0, box.y + box.height / 2 - SHARE.height / 2),
		...SHARE,
	});
	await share.context.close();
	const phone = await openList(state, locale, PHONE);
	// Cropped above the fixed "New event" button, which would sit on the card.
	await save(phone.page, `hero-mobile-${lang}`, {
		x: 0,
		y: 0,
		width: PHONE.width,
		height: PHONE.height - 90,
	});
	await phone.context.close();
}

try {
	mkdirSync(OUT, { recursive: true });
	for (const language of LANGUAGES) {
		const state = await signIn(emailOf(language[0]));
		await inviteGuest(state, language[0]);
		await capture(state, language);
	}
} finally {
	await browser.close();
}
