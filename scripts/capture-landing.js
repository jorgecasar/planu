/**
 * Captures the landing hero screenshot of the app, once per language (#271, R4).
 *
 * Needs `npm run emulators`, `npm run seed:landing` and `npm run dev` running.
 * It signs in as the seeded account in English, keeps the session (with its
 * IndexedDB) and replays it for Spanish, answers every cover request with the
 * synthetic SVG of `landing-covers.js` instead of the network, and writes
 * `apps/web/public/assets/landing/hero-<lang>.webp`.
 *
 * Chromium cannot encode webp from `screenshot`, so the PNG goes through a
 * canvas in the page: no image dependency is added. Each file must stay under
 * 60 KB, or the run fails and says which one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { coverNameOf, coverSvg } from "./landing-covers.js";

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3000";
const OUT = "apps/web/public/assets/landing";
const EMAIL = process.env.CAPTURE_EMAIL ?? "landing.demo@example.com";
const PASSWORD = "secret123";
const SIZE = { width: 1200, height: 675 };
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

/** Signs in as the seeded account in English and returns the saved session. */
async function signIn() {
	const context = await browser.newContext({ locale: "en-US", viewport: SIZE });
	await withCovers(context);
	const page = await context.newPage();
	await page.goto(`${BASE}/app/login`);
	// Both tab panels carry the labels; the sign-in one comes first.
	await page.getByLabel("Email").first().fill(EMAIL);
	await page.getByLabel("Password", { exact: true }).first().fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(`${BASE}/app`);
	const state = await context.storageState({ indexedDB: true });
	await context.close();
	return state;
}

/** The list of the seeded account, as a webp under the size limit. */
async function capture(state, [lang, locale]) {
	const context = await browser.newContext({
		locale,
		viewport: SIZE,
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
	const png = await page.screenshot({ type: "png" });
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
	await context.close();
	const bytes = Buffer.from(webp);
	if (bytes.length > MAX_BYTES) {
		throw new Error(
			`hero-${lang}.webp is ${bytes.length} bytes, over ${MAX_BYTES}`,
		);
	}
	writeFileSync(`${OUT}/hero-${lang}.webp`, bytes);
	console.log(
		`hero-${lang}.webp ${bytes.length} bytes, ${SIZE.width}x${SIZE.height}`,
	);
}

try {
	mkdirSync(OUT, { recursive: true });
	const state = await signIn();
	for (const language of LANGUAGES) await capture(state, language);
} finally {
	await browser.close();
}
