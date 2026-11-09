import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Watches the ratchet that isolates Firebase, defined in `biome.json`.
 *
 * Biome checks that nobody imports `firebase/**` outside the exemption
 * list. What it does **not** check is that that list stays tight: one
 * extra entry leaves a free zone and the lint stays green. It has already
 * happened — a `sharing/**` wildcard exempted three files that did not
 * import Firebase, one of them a dependency-free policy module, and only a
 * review caught it.
 *
 * And it watches the gate, not just the list: deleting the override that
 * **enforces** the rule left the four assertions green and the lint clean.
 * That was also found by a review, not by this file.
 *
 * Runs in Node with no emulators: it only reads files.
 */

// `fileURLToPath` and not `import.meta.dirname`, which requires Node ≥20.11
// while `engines` declares `>=20`.
const RAIZ = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(RAIZ, "apps/web/src");

type Override = {
	includes: string[];
	linter?: { rules?: { style?: { noRestrictedImports?: unknown } } };
};

function overrides(): Override[] {
	const config = JSON.parse(readFileSync(join(RAIZ, "biome.json"), "utf8")) as {
		overrides?: Override[];
	};
	return config.overrides ?? [];
}

const regla = (o: Override) => o.linter?.rules?.style?.noRestrictedImports;

/** The one that forbids. Found by shape, not by position. */
const imponen = () => overrides().filter((o) => typeof regla(o) === "object");
/** The one that exempts. Same idea. */
const eximen = () => overrides().filter((o) => regla(o) === "off");

/**
 * Every .ts under a directory, as paths relative to the repo root.
 */
function ficherosBajo(dir: string): string[] {
	const salida: string[] = [];
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) salida.push(...ficherosBajo(ruta));
		else if (ruta.endsWith(".ts")) salida.push(relative(RAIZ, ruta));
	}
	return salida;
}

/**
 * Which files a pattern covers. Only two shapes are allowed — an exact path
 * and `directorio/**` — on purpose: a more expressive wildcard is harder to
 * audit at a glance, and the "only exact paths or directorio/**" assertion
 * is what keeps a shape that Biome understands and this does not from
 * sneaking in here.
 */
function cubiertos(patron: string, todos: string[]): string[] {
	if (patron.endsWith("/**")) {
		const prefijo = patron.slice(0, -2);
		return todos.filter((f) => f.startsWith(prefijo));
	}
	return todos.filter((f) => f === patron);
}

/**
 * The five shapes Biome flags: static, `import type`, `export … from`,
 * dynamic — even split across several lines — and side-effect, plus the
 * bare `firebase` root package with no slash.
 */
const importaFirebase = (fichero: string): boolean =>
	/(?:from|import)\s*\(?\s*["']firebase(?:\/|["'])/.test(
		readFileSync(join(RAIZ, fichero), "utf8"),
	);

/**
 * Files coupled today. **Can only go down**, unless raising it has its own
 * justification recorded right here: raising it with no explanation is
 * coupling more code to Firebase by sneaking into a diff, instead of
 * discussing it in a review. It counts files, not list entries.
 *
 * T36 brought it down from 23 to 19: it freed six —`app-shell.ts`,
 * `login-view.ts`, `guard.ts` and `guard.test.ts`, and `auth-errors.ts` with
 * its test, moved to `domain/`— and added two new ones under
 * `infrastructure/firebase/**`, the migration's first adapter.
 * `profile-view.ts` stays on the list: it no longer imports `firebase/auth`,
 * but it still keeps `firebase/firestore` to publish to the user directory,
 * and that's Firestore — T37's port, not the session one.
 *
 * T31 raised it from 19 to 21, with nothing freed this time: `analytics/`
 * had no `firebase/*` import to begin with —the whole point was giving it
 * `AnalyticsPort` and never a Firebase type— so the two new files are
 * `infrastructure/firebase/analytics-adapter.ts` and its test, the
 * migration's second adapter. Same shape as T36's raise, and the same
 * reason it is not a workaround: the count only ever grows here on purpose,
 * inside the one place `firebase/*` is meant to live, never by adding an
 * exemption elsewhere to dodge the count.
 *
 * T48 (hours-in-events spec) raises it again, from 21 to 23, and is a
 * documented exception the same way. It migrates `event-editor.ts` to
 * `EventRepositoryPort` and `ImageStorePort`: it no longer imports
 * `firebase/firestore` or `firebase/storage`, which was the coupling that
 * actually mattered — saving, with the normalisation from the hours spec's
 * decision 5. But the file **stays on the list** for an unrelated reason:
 * `firebase/app` (the `FirebaseApp` type it needs to build the AI model) and
 * the dynamic import of `firebase/ai`, both from T24's tag-suggestion
 * feature and out of scope for T48. And it adds two new adapters under
 * `infrastructure/firebase/**` —`event-repository.ts`, `image-store.ts`—,
 * which do count even though that is exactly where this coupling belongs.
 * Net result: no reduction yet. Getting `event-editor.ts` off the list
 * entirely is T37/T38's job, which cover the same file with broader scope
 * —also `event-card.ts` and `events-view.ts`—.
 *
 * T48's own review raises it once more, from 23 to 26: `event-repository.ts`
 * and `image-store.ts` shipped with no test at all, unlike their siblings
 * `session-adapter.ts`/`analytics-adapter.ts`, which the review flagged as
 * a real gap — the whole point of a port is testing its logic without an
 * emulator, and that logic went untested. The fix adds
 * `event-repository.test.ts` and `image-store.test.ts` next to their
 * adapters, plus `firebase/storage.test.ts` for `uploadFile()` (now shared
 * by `FirebaseImageStore`, which used to duplicate its upload wiring
 * instead of calling it). All three mock the SDK with `vi.mock`, the same
 * pattern as `analytics-adapter.test.ts`, and only need a type-only import
 * to do it — but a type-only import is still an import, so they land back
 * on this list. Three files, three points on the counter.
 *
 * T32 raises it once more, from 26 to 27, landing independently of T48's
 * work above: one new file, not two, because `account-data-adapter.ts` has
 * no pure exported function worth a unit test the way
 * `toSessionUser()`/`toSessionError()` earned `session-adapter.ts` one —
 * everything here is a thin wrapper around real Firestore/Storage calls,
 * verified by T32's end-to-end test against the emulators instead, same as
 * `event-card.ts` and the rest of `events/` already are.
 *
 * T38 raises it once more, from 27 to 28: the migration of `ai-event-generator.ts`
 * and its test to consume `ImageStorePort` instead of `firebase/storage` is
 * complete. However, this component still needs `firebase/app` (the `FirebaseApp`
 * type for the AI model) and a dynamic import of `firebase/ai` (for building
 * the generative model), which are out of scope for T38 — they belong to the
 * AI model session work (T24/T48). Both files remain on the exemption list for
 * these remaining legitimate couplings.
 *
 * T37 frees three files — `event-card.ts`, `events-view.ts` and
 * `lib/types.ts` — and adds four under `infrastructure/firebase/**`, net
 * +1, from 27 to 28.
 *
 * `event-card.ts` moves its two remaining Firestore calls — `deleteDoc` and
 * the "leave someone else's event" `updateDoc` from ADR 0006 — behind two
 * new `EventRepositoryPort` methods, `delete()` and `leave()`, implemented
 * by `FirebaseEventRepository` (already on the list, so no new file there).
 * `lib/types.ts` loses `PlanuEventDocument` and its `Timestamp` import
 * entirely: that type only ever described the persistence shape, per
 * `spec-arquitectura-hexagonal.md`'s own note that this was a known gap to
 * close here. `events-view.ts` loses `firestoreContext`, `Timestamp`,
 * `CollectionController` and its local `toEvent()` — it now consumes a new
 * `eventsContext` (`StoredEvent[]`, already translated, plus a
 * loading/ready/error status) and no longer imports `firebase/firestore`
 * at all.
 *
 * What that live listing needs — the query, `onSnapshot`, and the
 * `Timestamp`↔`Date` mapping `toEvent()` used to do — didn't disappear, it
 * moved: `event-mapper.ts` (`toStoredEvent()` and the relocated
 * `PlanuEventDocument`) and `events-controller.ts` (the query-building and
 * subscription logic, called from `firebase-provider.ts`, which is what
 * turns its `.snapshot` into `eventsContext`'s value — the same shape
 * `onAuthStateChanged` already gets turned into `SessionUser` there). Two
 * files, plus their two tests: `EventRepositoryPort` stayed
 * per-operation on purpose (no subscription method), so this is
 * infrastructure the same way `CollectionController` already was, not a
 * port that needed widening. Testing the pure parts — `toStoredEvent()`'s
 * validation and `EventsController`'s query/status logic — without an
 * emulator is the whole point of moving them here, per
 * `spec-arquitectura-hexagonal.md`'s success criteria, so both get one.
 *
 * The `SharingPort` migration frees three files — `profile-view.ts`,
 * `share-dialog.ts` and `user-directory.ts` — and adds two under
 * `infrastructure/firebase/**`, net -1, from 29 to 28.
 *
 * A new `SharingPort` (`application/ports/sharing.ts`) covers everything
 * `share-dialog.ts` and the directory's two triggers need — lookups,
 * inviting by uid, listing and revoking invitations, changing a guest's
 * role, rewriting event membership and publishing the directory entry —
 * implemented by `infrastructure/firebase/sharing-adapter.ts`, with no
 * change in behaviour. `user-directory.ts` sheds every Firestore call and
 * keeps only `emailHash()` and the two collection name constants, all pure;
 * `share-dialog.ts` drops `firebase/firestore` entirely in favour of
 * `@consume`. `profile-view.ts` loses its own `firebase/firestore` import as
 * a direct consequence — its only remaining reason for being on this list
 * was publishing to the directory, and that now goes through the same port —
 * so it comes off too, required by the "no exime ningún fichero que no
 * importe Firebase" assertion below. Net two new files under
 * `infrastructure/firebase/**` (the adapter and its test, which — like
 * `publishDirectoryEntry`'s real decision logic — earns a unit test the way
 * `account-data-adapter.ts`'s thinner wrappers did not) against three
 * freed, for -1 overall.
 *
 * The `AiModelPort` migration (#107) frees two files —
 * `ai-event-generator.ts` and its test— and adds one,
 * `infrastructure/firebase/ai-model-adapter.ts`, net -1, from 28 to 27. No
 * adapter test, same reason as `account-data-adapter.ts`: it only forwards
 * to `getAI`/`getGenerativeModel`. The component test drives a fake port
 * instead of mocking `firebase/ai`.
 *
 * #106 frees `event-editor.ts`, from 27 to 26: tag suggestion builds its
 * model through the same `AiModelPort`. No new file.
 */
const TOPE_ACOPLADOS = 26;

const TODOS = ficherosBajo(SRC);
const LISTA = eximen().flatMap((o) => o.includes);

describe("la frontera de Firebase", () => {
	test("biome.json conserva un override que impone y otro que exime", () => {
		// Without this, deleting the one that enforces leaves the rest of the
		// assertions green and the lint clean: the watcher would be guarding
		// the list and not the gate.
		expect({ imponen: imponen().length, eximen: eximen().length }).toEqual({
			imponen: 1,
			eximen: 1,
		});
	});

	test("el override que impone cubre todo src y todo el paquete firebase", () => {
		const [impone] = imponen();
		expect(impone?.includes).toEqual(["apps/web/src/**"]);

		const opciones = regla(impone as Override) as {
			options?: { patterns?: { group?: string[] }[] };
		};
		const grupo = opciones.options?.patterns?.[0]?.group ?? [];
		// Bare `firebase` in addition to `firebase/**`: the root package can
		// also be imported.
		expect(grupo).toContain("firebase/**");
		expect(grupo).toContain("firebase");
	});
});

describe("la lista de exenciones", () => {
	test("no exime ningún fichero que no importe Firebase", () => {
		const sobrantes = LISTA.flatMap((patron) =>
			cubiertos(patron, TODOS).filter((f) => !importaFirebase(f)),
		);

		// A file exempted with no need for it is a free zone: tomorrow
		// someone adds Firebase there and nothing complains.
		expect(sobrantes).toEqual([]);
	});

	test("no tiene entradas muertas", () => {
		const vacias = LISTA.filter((p) => cubiertos(p, TODOS).length === 0);

		// A path that matches nothing is usually a renamed file, and leaves
		// the list counting exemptions that no longer exist.
		expect(vacias).toEqual([]);
	});

	test("cubre todo lo que hoy importa Firebase", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		const sinEximir = TODOS.filter(
			(f) => importaFirebase(f) && !eximidos.has(f),
		);

		// The lint would also catch this; here the message says which ones
		// they are.
		expect(sinEximir).toEqual([]);
	});

	test("no crece", () => {
		const eximidos = new Set(LISTA.flatMap((p) => cubiertos(p, TODOS)));
		expect(eximidos.size).toBeLessThanOrEqual(TOPE_ACOPLADOS);
	});

	test("sólo usa rutas exactas o `directorio/**`", () => {
		// The negation reads as "narrow down" but to Biome means "exclude", so
		// it is rejected separately so the message does not lie.
		expect(LISTA.filter((p) => p.startsWith("!"))).toEqual([]);
		expect(LISTA.filter((p) => p.includes("*") && !p.endsWith("/**"))).toEqual(
			[],
		);
	});
});
