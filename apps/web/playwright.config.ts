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
	// Playwright's 30s/5s defaults, not raised: doubling both to 60s/10s was
	// tried against real CI contention (`nproc` = 2 on the runner, `vmstat`
	// measured genuine CPU pressure) and only took a failure count from
	// 8-10 down to 6 — with those 6 still burning the full 60s on a click
	// that resolves in under a second locally, more consistent with an
	// unbounded hang than bounded contention. `test:e2e` came out of
	// `.github/workflows/ci.yml` instead of raising the timeout further; the
	// defaults are what every local run in this investigation actually
	// needed. If e2e goes back into CI, start from 60s/10s with the
	// evidence in docs/spec-ci-e2e-reliability.md rather than guessing again.
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
