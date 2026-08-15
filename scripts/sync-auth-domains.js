/**
 * Keeps the Firebase Auth authorized-domains list in sync with the Hosting
 * preview channels that actually exist.
 *
 * Why this is needed: Firebase Auth only allows OAuth from domains on that
 * list, and it does not accept wildcards. Every preview channel gets a fresh
 * `planu-app--<channel>-<hash>.web.app`, so without this the console warns
 * "The current domain is not authorized for OAuth operations" and
 * `signInWithPopup` never opens. Email and password keep working, which is
 * what makes the breakage easy to miss.
 *
 * The hash is **not** stable: deleting and recreating the same channel yields
 * a different one (verified). So authorizing once per PR is not enough, and
 * pruning is mandatory or the list grows forever.
 *
 *   node scripts/sync-auth-domains.js --add <domain> [--dry-run]
 *
 * Requires ACCESS_TOKEN in the environment (in CI, from
 * google-github-actions/auth with token_format: access_token) and the
 * `firebaseauth.configs.get` / `.update` permissions.
 *
 * The Identity Toolkit admin API has no "append" endpoint, so this is a
 * read-modify-write of the whole list. Two jobs doing it at once would clobber
 * each other; the workflow serializes them with a shared concurrency group.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const PROJECT = "planu-app";
const API = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

/** Never removed, whatever the channel list says. */
const PROTECTED = new Set([
	`${PROJECT}.web.app`,
	`${PROJECT}.firebaseapp.com`,
	"localhost",
]);

/** Only domains matching this shape are ever considered for pruning. */
const PREVIEW = new RegExp(`^${PROJECT}--.+\\.web\\.app$`);

const args = process.argv.slice(2);
const add = args.includes("--add") ? args[args.indexOf("--add") + 1] : null;
const dryRun = args.includes("--dry-run");

const token = process.env["ACCESS_TOKEN"];
if (!token) {
	console.error("ACCESS_TOKEN is not set");
	process.exit(1);
}

/** Domains of the preview channels that are still alive. */
async function liveChannelDomains() {
	const { stdout } = await run(
		"npx",
		["firebase", "hosting:channel:list", "--project", PROJECT, "--json"],
		{ maxBuffer: 10 * 1024 * 1024 },
	);
	const channels = JSON.parse(stdout).result?.channels ?? [];
	return new Set(channels.map((c) => new URL(c.url).host));
}

async function getAuthorized() {
	const response = await fetch(API, {
		headers: {
			Authorization: `Bearer ${token}`,
			// Identity Toolkit bills against a quota project and refuses the
			// request without it when the caller is a user credential.
			"x-goog-user-project": PROJECT,
		},
	});
	if (!response.ok) {
		throw new Error(`GET config: ${response.status} ${await response.text()}`);
	}
	return (await response.json()).authorizedDomains ?? [];
}

async function putAuthorized(domains) {
	const response = await fetch(`${API}?updateMask=authorizedDomains`, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"x-goog-user-project": PROJECT,
		},
		body: JSON.stringify({ authorizedDomains: domains }),
	});
	if (!response.ok) {
		throw new Error(
			`PATCH config: ${response.status} ${await response.text()}`,
		);
	}
}

const [current, live] = await Promise.all([
	getAuthorized(),
	liveChannelDomains(),
]);

const keep = current.filter(
	(domain) =>
		PROTECTED.has(domain) || !PREVIEW.test(domain) || live.has(domain),
);
const pruned = current.filter((d) => !keep.includes(d));

const next = [...keep];
if (add && !next.includes(add)) next.push(add);

console.log(`authorized now: ${current.length}`);
if (add)
	console.log(`  + ${add}${current.includes(add) ? " (already there)" : ""}`);
for (const domain of pruned) console.log(`  - ${domain} (no live channel)`);

if (next.length === current.length && next.every((d, i) => d === current[i])) {
	console.log("nothing to change");
	process.exit(0);
}

if (dryRun) {
	console.log(`dry run, would write ${next.length}:`);
	for (const d of next) console.log(`    ${d}`);
	process.exit(0);
}

await putAuthorized(next);
console.log(`written: ${next.length} domains`);
