import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env["CI"],
	// No retries, not even in CI: a test that fails and passes on retry
	// counts as "flaky" to Playwright, not "failed", and exits 0 — the
	// pipeline AGENTS.md calls worse than no test at all. Kept even though
	// `test:e2e` isn't in `.github/workflows/ci.yml` right now (see below):
	// this is what makes `npm run test:e2e` trustworthy for local runs, and
	// what it needs to still be if this suite ever goes back into CI. See
	// docs/spec-ci-e2e-reliability.md.
	retries: 0,
	// Sized from real measurement, not a guess — but currently exercised
	// only by local runs, not CI: `test:e2e` was pulled out of
	// `.github/workflows/ci.yml` after four real runs kept failing with
	// `Test timeout of 30000ms exceeded` waiting on something in
	// `/app/login`, never reproduced locally. `vmstat` during one of those
	// runs found GitHub's runner reporting `nproc` = 2, with 9% of seconds
	// under 10% idle CPU (5% at exactly 0%) — Node, two JVMs (Firestore +
	// Storage rules) and Chromium sharing two cores. Doubling this to 60s
	// only took the failure count from 8-10 down to 6, and those 6 burned
	// the full 60s on a click that resolves in under a second locally —
	// more consistent with an unbounded hang than bounded contention, which
	// is why the timeout wasn't pushed further and `test:e2e` came out of
	// CI instead. Left at this value for whenever e2e goes back into CI, or
	// for anyone investigating the hang locally against a throttled
	// environment. See docs/spec-ci-e2e-reliability.md.
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: "list",
	use: {
		baseURL: `http://localhost:${process.env["PORT"] || 3000}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "npm run dev",
		// Not the root: that is reserved for the landing and serves nothing yet,
		// so Playwright would wait for a 404 until it timed out and report it as
		// "the server never started".
		url: `http://localhost:${process.env["PORT"] || 3000}/app`,
		reuseExistingServer: !process.env["CI"],
	},
});
