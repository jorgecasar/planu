import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env["CI"],
	retries: process.env["CI"] ? 2 : 0,
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
