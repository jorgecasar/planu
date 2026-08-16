import { defineConfig } from "vitest/config";

/**
 * Tests de arquitectura: comprueban el repositorio, no la aplicación.
 *
 * Corren en Node porque leen ficheros, y **no necesitan emuladores**, así que
 * van con la calidad estática en CI y no con la tanda lenta. Configuración
 * propia por eso mismo: el bloque `test` de `vite.config.ts` levanta Chromium y
 * `vitest.rules.config.ts` espera un emulador delante.
 */
export default defineConfig({
	test: {
		include: ["arch/**/*.test.ts"],
		environment: "node",
	},
});
