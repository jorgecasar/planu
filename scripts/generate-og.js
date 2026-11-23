/**
 * Regenerates apps/web/public/assets/landing/og.png (1200 x 630, the size the
 * Open Graph tags declare) from assets already in the repo: public/logo.svg,
 * the self-hosted Belleza and Alegreya faces and the planu theme colours.
 *
 * PLACEHOLDER: it is built from the current identity only. The brand identity
 * decision (HU-428) is pending; when it lands, edit TEMPLATE below and rerun.
 * Do not invent a new look here.
 *
 * Usage: node scripts/generate-og.js
 * Needs the Playwright Chromium (`npx playwright install chromium`); adds no
 * dependency. See docs/seo-landing.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PUBLIC = fileURLToPath(new URL("../apps/web/public/", import.meta.url));
const OUT = `${PUBLIC}assets/landing/og.png`;
const SIZE = { width: 1200, height: 630 };

// Colours are the brand tokens of ui/styles/theme-planu.css (light theme).
const INK = "#1a237e";
const BRAND = "#3f51b5";
const SOFT = "#e8eaf6";

const font = (name, file) =>
	`@font-face{font-family:"${name}";font-weight:400 700;src:url("data:font/woff2;base64,${readFileSync(`${PUBLIC}fonts/${file}`).toString("base64")}") format("woff2")}`;

const logo = readFileSync(`${PUBLIC}logo.svg`, "utf8");

const TEMPLATE = `<!doctype html><html><head><meta charset="utf-8"><style>
${font("Belleza", "belleza-latin-400.woff2")}
${font("Alegreya", "alegreya-latin-400.woff2")}
html,body{margin:0;width:${SIZE.width}px;height:${SIZE.height}px}
body{background:${SOFT};display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box}
svg{width:240px;height:240px;flex:none}
h1{font:400 150px/1 Belleza,sans-serif;color:${BRAND};margin:0}
p{font:400 44px/1.25 Alegreya,serif;color:${INK};margin:12px 0 0}
</style></head><body>${logo}<div><h1>planu</h1><p>The private event planner</p></div></body></html>`;

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: SIZE });
	await page.setContent(TEMPLATE);
	await page.evaluate(() => document.fonts.ready);
	writeFileSync(OUT, await page.screenshot({ type: "png" }));
	console.log(`✓ ${OUT}`);
} finally {
	await browser.close();
}
