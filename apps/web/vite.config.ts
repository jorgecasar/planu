import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
import type { Plugin, PluginOption } from "vite";
// `loadEnv` sale de vite; `vitest/config` sólo reexporta `defineConfig`.
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Los .env viven en la raíz del monorepo, no en apps/web. Sin esto Vite los
// busca junto a este fichero y la app arranca sin configuración de Firebase.
const envDir = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Serves /app/** from app.html while developing.
 *
 * Vite's SPA fallback looks for index.html, which no longer exists: the root is
 * reserved for the landing the build will prerender. Without this, every route
 * under /app is a 404 in dev while working fine in production — the worst way
 * round for a routing change.
 */
function appRoutes(): Plugin {
	return {
		name: "planu-app-routes",
		configureServer(server) {
			server.middlewares.use((request, _response, next) => {
				const [path] = (request.url ?? "").split("?");
				// Extension-less paths only, so assets under /app still resolve.
				if (path?.startsWith("/app") && !path.includes(".")) {
					request.url = "/app.html";
				}
				next();
			});
		},
	};
}

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

	const plugins: PluginOption[] = [appRoutes()];

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
		// Banderas de compilación del SDK de Sentry. Sin ellas, su bundle
		// arrastraba Session Replay con grabación de canvas, el widget de
		// Feedback y el tracing —que está apagado por configuración—: 455 KiB
		// en crudo con un 83 % sin ejecutar nunca. `__SENTRY_TRACING__` seguía
		// literal en el bundle publicado, señal de que la rama sobrevivía al
		// tree-shaking por no estar sustituida aquí.
		define: {
			__SENTRY_TRACING__: "false",
			__SENTRY_DEBUG__: "false",
			__RRWEB_EXCLUDE_CANVAS__: "true",
			__RRWEB_EXCLUDE_SHADOW_DOM__: "true",
		},
		// No SPA fallback: with the landing coming, the root stops being the
		// application and Vite must not serve app.html for every path.
		appType: "mpa" as const,
		server: {
			// Overridable so two worktrees can run at once. Playwright reuses
			// whatever already answers on the port, so a second checkout silently
			// tests the first one's code — which looks exactly like a bug in the
			// routing being changed here.
			// `??` alone would not do: loadEnv yields "" for an unset variable,
			// and Number("") is 0 — which Vite reads as "any free port".
			port: env["PORT"] ? Number(env["PORT"]) : 3000,
			host: "0.0.0.0",
		},
		build: {
			target: "es2022",
			rollupOptions: {
				input: fileURLToPath(new URL("./app.html", import.meta.url)),
			},
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
				// La zona horaria **no** se fija aquí. Se intentó con
				// `playwright({ contextOptions: { timezoneId } })` y es inerte: con
				// `TZ=UTC` en el entorno el navegador reportaba offset 0 pese a pedir
				// `America/Santiago`. Manda la variable del proceso, así que vive en
				// el script `test` de `package.json`, que es lo único que comprobado
				// llega hasta aquí. `build-ics.test.ts` lo verifica antes de fiarse.
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
