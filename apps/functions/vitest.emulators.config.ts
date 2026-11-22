import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.emulator.test.ts"],
		testTimeout: 30_000,
		// One emulator, one wipe-and-seed at a time.
		fileParallelism: false,
	},
});
