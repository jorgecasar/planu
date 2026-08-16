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
	// 26 caracteres, pero 24 una vez recortada: debe valer.
	const justa = `  ${"a".repeat(MAX_TAG_LENGTH)}  `;
	expect(normalizeTag(justa)).toBe("a".repeat(MAX_TAG_LENGTH));
});

test("rechaza en vez de truncar lo que pasa del máximo", () => {
	const larga = "a".repeat(MAX_TAG_LENGTH + 1);
	// Truncar dejaría al usuario con una etiqueta que él no escribió.
	expect(normalizeTag(larga)).toBeNull();
});

test("la longitud se mide en unidades UTF-16, como las reglas y el campo", () => {
	// Un emoji fuera del plano básico ocupa dos unidades, así que caben doce.
	// Medirlo en puntos de código dejaba pasar diez etiquetas de 24 emojis
	// —489 unidades— que las reglas después denegaban con un error mudo.
	// Comprobado contra el emulador: `size()` cuenta unidades UTF-16.
	const doce = "🎵".repeat(12);
	expect(doce.length).toBe(MAX_TAG_LENGTH);
	expect(normalizeTag(doce)).toBe(doce);
	expect(normalizeTag("🎵".repeat(13))).toBeNull();
});

test("el peor caso legítimo cabe en el tope agregado de las reglas", () => {
	// Diez etiquetas del máximo más nueve separadores: 249 unidades, y las
	// reglas admiten 280. Si alguien sube MAX_TAGS o MAX_TAG_LENGTH sin tocar
	// el tope de `firestore.rules`, este test cae antes que un usuario.
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
	// Se queda con las primeras, no con unas cualesquiera.
	expect(salida[0]).toBe("tag-0");
	expect(salida.at(-1)).toBe(`tag-${MAX_TAGS - 1}`);
});

test("los duplicados no gastan cupo", () => {
	// Once entradas pero sólo diez distintas: no debe perderse la última.
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
	// No es una garantía matemática —360 tonos, colisiones habrá— pero sí lo
	// es para estas seis, y sin la aserción el hash podría degenerar a una
	// constante sin que nadie se enterase.
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
	// Con un hash que sumase códigos, «ab» y «ba» colisionarían.
	expect(tagHue("ab")).not.toBe(tagHue("ba"));
});

// --- suggestTags ----------------------------------------------------------

test("sugiere por subcadena, no sólo por prefijo", () => {
	const known = ["música clásica", "cine", "concierto"];
	expect(suggestTags(known, "clásica")).toEqual(["música clásica"]);
});

test("lo que empieza por el término va primero", () => {
	// «arte» y no «música» a propósito: con `música clásica` el orden
	// alfabético ya coincidía con el de prefijo y el test pasaba igual sin la
	// prioridad puesta. Aquí los dos criterios se contradicen, que es lo único
	// que demuestra cuál manda.
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
 * Veinte etiquetas conocidas, de la `tag19` a la `tag00`.
 *
 * En orden inverso a propósito, y afirmando el contenido y no el recuento: con
 * veinte `tag-N` cualesquiera y un `toHaveLength`, diez supervivientes
 * satisfacían el test igual de bien que veinte, y por ahí se coló que
 * `suggestTags` truncase el vocabulario a diez antes de filtrarlo. Aquí las
 * primeras por orden alfabético son justo las últimas de la entrada, así que un
 * corte por delante cambia la respuesta.
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
	// Sin esto, el valor por defecto no lo fijaba nadie: subirlo a 50 dejaba
	// la suite en verde y el editor escupiendo veinte sugerencias.
	expect(suggestTags(VEINTE, "tag")).toEqual([
		"tag00",
		"tag01",
		"tag02",
		"tag03",
		"tag04",
	]);
});

test("sugiere una etiqueta conocida aunque no esté entre las diez primeras", () => {
	// `known` es el vocabulario del usuario —la unión de las etiquetas de todos
	// sus eventos— y no tiene cota, mientras que `MAX_TAGS` acota las de **un**
	// evento. Saneando con `normalizeTags` se truncaba a diez antes de filtrar,
	// y el autocompletado dejaba de encontrar nada a partir de ahí: con quince
	// conocidas y ordenadas, «viaje» no se sugería aunque estuviese.
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
	// `normalizeTag` devuelve null aquí; sin el respaldo, el término se
	// perdería y se ofrecerían todas las etiquetas en vez de ninguna.
	expect(suggestTags(["cine"], "z".repeat(MAX_TAG_LENGTH + 1))).toEqual([]);
});
