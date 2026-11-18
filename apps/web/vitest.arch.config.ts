import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = resolve(import.meta.dirname, "../..");

/**
 * Tests de arquitectura: comprueban el repositorio, no la aplicación.
 *
 * Corren en Node porque leen ficheros, y **no necesitan emuladores**, así que
 * van con la calidad estática en CI y no con la tanda lenta. Configuración
 * propia por eso mismo: el bloque `test` de `vite.config.ts` levanta Chromium y
 * `vitest.rules.config.ts` espera un emulador delante.
 *
 * La cobertura sólo mide `scripts/check-coverage-fresh.js`, el único script
 * que estos tests ejecutan. Va a `coverage/arch/`, dentro de la carpeta ya
 * ignorada por git, y Sonar lee los dos informes (`sonar-project.properties`).
 * Por eso corre **después** de la tanda principal: ésta vacía `coverage/`.
 * `projectRoot` hace que la ruta salga como `scripts/...`, relativa a la raíz
 * del repositorio, que es lo que Sonar resuelve.
 */
export default defineConfig({
	test: {
		include: ["arch/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			reportsDirectory: "coverage/arch",
			reporter: ["text", ["lcovonly", { projectRoot: repoRoot }]],
			include: ["**/scripts/check-coverage-fresh.js"],
			allowExternal: true,
		},
	},
});
