import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env["CI"],
	// No retries, not even in CI: a test that fails and passes on retry
	// counts as "flaky" to Playwright, not "failed", and exits 0. With that
	// the CI job can't fail on a broken e2e — exactly the pipeline
	// AGENTS.md calls worse than no test at all. See
	// docs/spec-ci-e2e-reliability.md.
	retries: 0,
	// Doubled from Playwright's 30s default, and measured before doing it:
	// GitHub's runner reports `nproc` = 2, and `vmstat` sampled during a real
	// failing run showed 9% of seconds under 10% idle CPU (5% at exactly 0%)
	// with Node, two JVMs (Firestore + Storage rules) and Chromium sharing
	// those two cores. Three real CI runs failed with the identical signature
	// — `Test timeout of 30000ms exceeded` waiting on something in
	// `/app/login`, a different test each time — never reproduced locally,
	// including with matched concurrency (`--workers=1`). This is a margin
	// fix for measured contention, not a guess: see
	// docs/spec-ci-e2e-reliability.md.
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
