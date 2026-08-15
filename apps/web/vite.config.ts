import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// Los .env viven en la raíz del monorepo, no en apps/web. Sin esto Vite los
	// busca junto a este fichero y la app arranca sin configuración de Firebase.
	envDir: fileURLToPath(new URL("../..", import.meta.url)),
	server: {
		port: 3000,
		host: "0.0.0.0",
	},
	build: {
		target: "es2022",
	},
	optimizeDeps: {
		// Declaradas para que Vitest no reoptimice a mitad de una tanda de tests,
		// lo que provoca recargas y resultados inestables.
		include: [
			"firebase/app",
			"firebase/auth",
			"firebase/firestore",
			"firebase/storage",
			"zod",
		],
		esbuildOptions: {
			target: "es2022",
		},
	},
	test: {
		exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.ts"],
			exclude: ["**/*.test.ts", "src/main.ts"],
		},
	},
});
