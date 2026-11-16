/**
 * Synthetic cover images for the landing screenshots (#271, R4).
 *
 * Drawn here, in code: a gradient and two shapes, no photograph and no third
 * party asset, so the provenance of every pixel is this file (decision D14).
 * `firestore.rules` only accepts an `imageUrl` on `firebasestorage.googleapis.com`,
 * so the seed writes that host and the capture script answers those requests
 * with `coverSvg(name)` instead of reaching the network.
 */
const BUCKET = "planu-app.firebasestorage.app";
const HOST = "https://firebasestorage.googleapis.com";

/** name → [from, to, shape colour]. Palette of the planu theme and neighbours. */
const PALETTES = {
	picnic: ["#f4b393", "#c8553d", "#fff1e0"],
	concert: ["#3d348b", "#7678ed", "#f7b801"],
	trip: ["#2a9d8f", "#264653", "#e9c46a"],
	dinner: ["#6d597a", "#b56576", "#ffcdb2"],
	match: ["#1d3557", "#457b9d", "#f1faee"],
	market: ["#bc6c25", "#606c38", "#fefae0"],
};

export const COVER_NAMES = Object.keys(PALETTES);

/** The `imageUrl` a seeded event stores for a cover. */
export const coverUrl = (name) =>
	`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(`landing/${name}.svg`)}?alt=media`;

/** The cover a request to `coverUrl(name)` is answered with. */
export function coverSvg(name) {
	const palette = PALETTES[name];
	if (!palette) throw new Error(`no cover called ${name}`);
	const [from, to, shape] = palette;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="800" height="450" fill="url(#g)"/>
<circle cx="610" cy="130" r="86" fill="${shape}" opacity="0.85"/>
<path d="M0 450 L0 330 Q200 230 400 330 T800 300 L800 450 Z" fill="${shape}" opacity="0.35"/>
</svg>`;
}

/** The cover name behind an `imageUrl`, or `undefined` if it is not ours. */
export function coverNameOf(url) {
	const match = url.match(/\/o\/landing%2F([a-z]+)\.svg/);
	return match && match[1] in PALETTES ? match[1] : undefined;
}
