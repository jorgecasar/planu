import { expect, test } from "vitest";
import {
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTag,
	normalizeTags,
	suggestTags,
	tagHue,
} from "./tags.js";

// --- normalizeTag ---------------------------------------------------------

test("recorta los extremos y baja a minúsculas", () => {
	expect(normalizeTag("  Concierto  ")).toBe("concierto");
	expect(normalizeTag("MÚSICA")).toBe("música");
});

test("colapsa los espacios interiores", () => {
	expect(normalizeTag("música   clásica")).toBe("música clásica");
	expect(normalizeTag("música\tclásica")).toBe("música clásica");
});

test("un texto vacío o sólo con espacios no es una etiqueta", () => {
	expect(normalizeTag("")).toBeNull();
	expect(normalizeTag("   ")).toBeNull();
	expect(normalizeTag("\n\t ")).toBeNull();
});

test("la longitud máxima se cuenta tras normalizar, no antes", () => {
	// 26 characters, but 24 once trimmed: it should be valid.
	const justa = `  ${"a".repeat(MAX_TAG_LENGTH)}  `;
	expect(normalizeTag(justa)).toBe("a".repeat(MAX_TAG_LENGTH));
});

test("rechaza en vez de truncar lo que pasa del máximo", () => {
	const larga = "a".repeat(MAX_TAG_LENGTH + 1);
	// Truncating would leave the user with a tag they did not write.
	expect(normalizeTag(larga)).toBeNull();
});

test("la longitud se mide en unidades UTF-16, como las reglas y el campo", () => {
	// An emoji outside the basic plane takes up two units, so twelve fit.
	// Measuring it in code points let through ten tags of 24 emoji each
	// — 489 units — which the rules then rejected with a silent error.
	// Checked against the emulator: `size()` counts UTF-16 units.
	const doce = "🎵".repeat(12);
	expect(doce.length).toBe(MAX_TAG_LENGTH);
	expect(normalizeTag(doce)).toBe(doce);
	expect(normalizeTag("🎵".repeat(13))).toBeNull();
});

test("el peor caso legítimo cabe en el tope agregado de las reglas", () => {
	// Ten tags at the maximum plus nine separators: 249 units, and the rules
	// allow 280. If someone raises MAX_TAGS or MAX_TAG_LENGTH without touching
	// the cap in `firestore.rules`, this test fails before a user does.
	const peor = Array.from({ length: MAX_TAGS }, (_, i) =>
		`${i}`.padEnd(MAX_TAG_LENGTH, "x"),
	);
	const normalizadas = normalizeTags(peor);
	expect(normalizadas).toHaveLength(MAX_TAGS);
	expect(normalizadas.join("\n").length).toBeLessThanOrEqual(280);
});

// --- normalizeTags --------------------------------------------------------

test("deduplica lo que sólo se diferencia en mayúsculas o espacios", () => {
	expect(normalizeTags(["Concierto", "  concierto", "CONCIERTO "])).toEqual([
		"concierto",
	]);
});

test("conserva el orden de aparición", () => {
	expect(normalizeTags(["zeta", "alfa", "zeta", "beta"])).toEqual([
		"zeta",
		"alfa",
		"beta",
	]);
});

test("descarta en silencio lo que no vale", () => {
	expect(normalizeTags(["  ", "válida", "a".repeat(99)])).toEqual(["válida"]);
});

test("corta en el máximo de etiquetas", () => {
	const muchas = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag-${i}`);
	const salida = normalizeTags(muchas);
	expect(salida).toHaveLength(MAX_TAGS);
	// Keeps the first ones, not arbitrary ones.
	expect(salida[0]).toBe("tag-0");
	expect(salida.at(-1)).toBe(`tag-${MAX_TAGS - 1}`);
});

test("los duplicados no gastan cupo", () => {
	// Eleven entries but only ten distinct: the last one must not be lost.
	const conDuplicado = [
		"a",
		"a",
		...Array.from({ length: 9 }, (_, i) => `t${i}`),
	];
	expect(normalizeTags(conDuplicado)).toHaveLength(MAX_TAGS);
	expect(normalizeTags(conDuplicado)).toContain("t8");
});

test("una lista vacía se queda vacía", () => {
	expect(normalizeTags([])).toEqual([]);
});

// --- tagHue ---------------------------------------------------------------

test("el mismo nombre da siempre el mismo tono", () => {
	expect(tagHue("concierto")).toBe(tagHue("concierto"));
});

test("nombres distintos dan tonos distintos", () => {
	// Not a mathematical guarantee — 360 hues, there will be collisions —
	// but it is one for these six, and without the assertion the hash could
	// degenerate into a constant without anyone noticing.
	const tonos = ["concierto", "cena", "viaje", "trabajo", "cine", "teatro"].map(
		tagHue,
	);
	expect(new Set(tonos).size).toBe(6);
});

test("el tono cae siempre dentro de la rueda de color", () => {
	for (const tag of ["", "a", "música clásica", "🎵", "z".repeat(24)]) {
		const tono = tagHue(tag);
		expect(tono).toBeGreaterThanOrEqual(0);
		expect(tono).toBeLessThan(360);
		expect(Number.isInteger(tono)).toBe(true);
	}
});

test("un carácter de diferencia cambia el tono", () => {
	// With a hash that just summed codes, "ab" and "ba" would collide.
	expect(tagHue("ab")).not.toBe(tagHue("ba"));
});

// --- suggestTags ----------------------------------------------------------

test("sugiere por subcadena, no sólo por prefijo", () => {
	const known = ["música clásica", "cine", "concierto"];
	expect(suggestTags(known, "clásica")).toEqual(["música clásica"]);
});

test("lo que empieza por el término va primero", () => {
	// The first known tag is deliberately from a different theme than the
	// query, not a variant of it: with a same-theme fixture, alphabetical
	// order already matched prefix order, and the test passed just the same
	// without the priority in place. Here the two criteria contradict each
	// other, which is the only thing that proves which one wins.
	const known = ["arte clásica", "clásica"];
	expect(suggestTags(known, "clás")).toEqual(["clásica", "arte clásica"]);
});

test("no ofrece las que ya están puestas", () => {
	const known = ["cine", "cena"];
	expect(suggestTags(known, "c", ["cine"])).toEqual(["cena"]);
});

test("sin término ofrece todas las disponibles", () => {
	expect(suggestTags(["cine", "cena"], "")).toEqual(["cena", "cine"]);
});

test("normaliza también lo que se teclea", () => {
	expect(suggestTags(["cine"], "  CIN  ")).toEqual(["cine"]);
});

/**
 * Twenty known tags, from `tag19` down to `tag00`.
 *
 * In reverse order on purpose, and asserting the content rather than the
 * count: with twenty arbitrary `tag-N` values and a `toHaveLength`, ten
 * survivors satisfied the test just as well as twenty, and that is how
 * `suggestTags` truncating the vocabulary to ten before filtering slipped
 * through. Here the first ones in alphabetical order are exactly the last
 * ones in the input, so a cut at the front changes the answer.
 */
const VEINTE = Array.from(
	{ length: 20 },
	(_, i) => `tag${String(19 - i).padStart(2, "0")}`,
);

test("respeta el límite", () => {
	expect(suggestTags(VEINTE, "tag", [], 3)).toEqual([
		"tag00",
		"tag01",
		"tag02",
	]);
});

test("sin límite explícito ofrece cinco como mucho", () => {
	// Without this, nothing pinned down the default: raising it to 50 left
	// the suite green while the editor spat out twenty suggestions.
	expect(suggestTags(VEINTE, "tag")).toEqual([
		"tag00",
		"tag01",
		"tag02",
		"tag03",
		"tag04",
	]);
});

test("sugiere una etiqueta conocida aunque no esté entre las diez primeras", () => {
	// `known` is the user's vocabulary — the union of the tags across all of
	// their events — and has no bound, while `MAX_TAGS` bounds those of **one**
	// event. Sanitising with `normalizeTags` truncated it to ten before
	// filtering, and autocomplete stopped finding anything past that point:
	// with fifteen known and sorted, "viaje" was not suggested even though it
	// was there.
	const known = [
		...Array.from(
			{ length: 14 },
			(_, i) => `otra${String(i).padStart(2, "0")}`,
		),
		"viaje",
	];
	expect(known).toHaveLength(MAX_TAGS + 5);
	expect(suggestTags(known, "viaje")).toEqual(["viaje"]);
});

test("un término que no encaja no sugiere nada", () => {
	expect(suggestTags(["cine", "cena"], "zzz")).toEqual([]);
});

test("un término más largo que el máximo no rompe la sugerencia", () => {
	// `normalizeTag` returns null here; without the fallback, the term would
	// be lost and every tag would be offered instead of none.
	expect(suggestTags(["cine"], "z".repeat(MAX_TAG_LENGTH + 1))).toEqual([]);
});
