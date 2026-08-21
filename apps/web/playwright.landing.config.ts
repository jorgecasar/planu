import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración aparte para la landing, y no por gusto.
 *
 * La landing **no existe en `npm run dev`**: la genera `build:landing` con
 * `@lit-labs/ssr` y sale a `dist/`. Un test suyo contra el servidor de
 * desarrollo comprobaría una página que no es la que se publica —el fallo que
 * AGENTS.md llama «un test que no puede fallar»—, así que ésta levanta un
 * servidor estático sobre `dist/` y exige que el build se haya hecho.
 *
 * Corre con `npm run test:e2e:landing`.
 */
const PORT = process.env["LANDING_PORT"] || 4173;

export default defineConfig({
	testDir: "./e2e-landing",
	fullyParallel: true,
	forbidOnly: !!process.env["CI"],
	retries: process.env["CI"] ? 2 : 0,
	reporter: "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		// `serve-dist.js` no hace fallback a index.html a propósito: la landing es
		// multipágina y un fallback haría pasar cualquier ruta inexistente.
		command: `node ../../scripts/serve-dist.js ${PORT}`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env["CI"],
		timeout: 60_000,
	},
});
