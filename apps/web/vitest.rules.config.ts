import { defineConfig } from "vitest/config";

/**
 * Los tests de reglas corren en Node contra el emulador, no en navegador:
 * usan el SDK de administración de reglas, que no existe en el cliente.
 * Por eso tienen configuración propia y no comparten la de `vitest.config.ts`.
 */
export default defineConfig({
	test: {
		include: ["rules/**/*.test.ts"],
		environment: "node",
		// Las reglas se cargan una vez por fichero y el emulador es compartido:
		// en paralelo los tests se pisarían los datos.
		fileParallelism: false,
		testTimeout: 20_000,
	},
});
