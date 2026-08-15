import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
// `loadEnv` sale de vite; `vitest/config` sólo reexporta `defineConfig`.
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Los .env viven en la raíz del monorepo, no en apps/web. Sin esto Vite los
// busca junto a este fichero y la app arranca sin configuración de Firebase.
const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
	// Prefijo vacío para leer también las claves sin `VITE_`. El token de Sentry
	// es una de ellas y no debe llegar al bundle: aquí sólo lo ve el proceso de
	// build, mientras que `import.meta.env` únicamente expone las `VITE_*`.
	const env = loadEnv(mode, envDir, "");
	const upload = env["SENTRY_UPLOAD"] === "true";
	const release = env["VITE_RELEASE"];
	const authToken = env["SENTRY_AUTH_TOKEN"];
	const org = env["SENTRY_ORG"];
	const project = env["SENTRY_PROJECT"];

	const plugins = [];

	if (upload) {
		// Fallar aquí y no más tarde. Subir source maps sin release es el fallo
		// silencioso clásico: Sentry acepta los ficheros, el despliegue se da por
		// bueno y las trazas siguen minificadas, porque no hay nada con lo que
		// casarlas. Mejor que el build pare y se lea el motivo.
		const falta = [
			release ? null : "VITE_RELEASE",
			authToken ? null : "SENTRY_AUTH_TOKEN",
			org ? null : "SENTRY_ORG",
			project ? null : "SENTRY_PROJECT",
		].filter((v) => v !== null);

		if (!release || !authToken || !org || !project) {
			throw new Error(
				`SENTRY_UPLOAD=true pero falta ${falta.join(", ")}. Sin eso los ` +
					"source maps se subirían y no se aplicarían a ninguna traza.",
			);
		}

		plugins.push(
			sentryVitePlugin({
				org,
				project,
				authToken,
				release: { name: release },
				sourcemaps: {
					// `firebase.json` ya excluye los .map del despliegue, pero
					// borrarlos aquí quita la dependencia de que ese glob siga siendo
					// correcto: si un día deja de estarlo, publicaríamos el código
					// fuente sin enterarnos.
					filesToDeleteAfterUpload: ["**/dist/**/*.map"],
				},
			}),
		);
	}

	return {
		envDir,
		plugins,
		server: {
			port: 3000,
			host: "0.0.0.0",
		},
		build: {
			target: "es2022",
			// "hidden": se generan pero el bundle no los referencia y no se
			// publican. Sin ellos una traza de producción es ilegible; publicándolos
			// se regala el código fuente. El plugin de Sentry los encuentra igual,
			// porque los empareja por debug ID y no por la URL del comentario.
			sourcemap: "hidden",
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
			// Explícito y no por exclusión: los tests de reglas viven en `rules/`,
			// corren en Node y tienen su propia configuración. Sin este `include`
			// acababan aquí y fallaban al importar `node:fs`.
			include: ["src/**/*.test.ts"],
			exclude: ["**/e2e/**", "**/rules/**", "**/node_modules/**", "**/dist/**"],
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
	};
});
