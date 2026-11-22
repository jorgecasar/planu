import { defineConfig } from "vitest/config";

// Unit tests only; the emulator ones run through `npm run test:emulators`.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.emulator.test.ts"],
	},
});
