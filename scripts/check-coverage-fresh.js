/**
 * Fails if the coverage report Sonar reads is missing or older than the sources
 * it describes (#244). A stale lcov gives a quality gate computed on code that
 * no longer exists, which is worse than no number.
 *
 * ```bash
 * npm run test:coverage
 * node scripts/check-coverage-fresh.js    # 0 fresh, 1 stale or missing
 * kj scan
 * ```
 * `src/generated/` is skipped: it is not measured, so a regenerated locale file
 * must not make a good report look old.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FIX = "run `npm run test:coverage`";

/** Every file under a directory, skipping the generated locales. */
function files(dir, base = dir) {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (relative(base, path).startsWith("generated")) return [];
		return statSync(path).isDirectory() ? files(path, base) : [path];
	});
}

/** @returns {{ok: true} | {ok: false, reason: string}} */
export function checkCoverageFresh({ lcov, src }) {
	let report;
	try {
		report = statSync(lcov);
	} catch {
		return { ok: false, reason: `${lcov} is missing: ${FIX} first.` };
	}
	const sources = files(src);
	if (sources.length === 0) {
		return { ok: false, reason: `no sources under ${src} to compare with.` };
	}
	const newest = sources
		.map((path) => ({ path, time: statSync(path).mtimeMs }))
		.reduce((a, b) => (b.time > a.time ? b : a));
	if (newest.time > report.mtimeMs) {
		return {
			ok: false,
			reason: `${lcov} is older than ${relative(src, newest.path)}: ${FIX} before analysing.`,
		};
	}
	return { ok: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = fileURLToPath(new URL("..", import.meta.url));
	const result = checkCoverageFresh({
		lcov: join(root, "apps/web/coverage/lcov.info"),
		src: join(root, "apps/web/src"),
	});
	if (!result.ok) {
		console.error(result.reason);
		process.exit(1);
	}
	console.log("coverage report is fresh");
}
