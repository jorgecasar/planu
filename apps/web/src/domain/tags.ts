/**
 * Normalización, sugerencia y color de las etiquetas.
 *
 * Vive en `domain/` porque no depende de nada: es la misma clase de módulo que
 * `filter-events.ts`. El editor, el filtro y la tarjeta se limitan a llamar
 * aquí, de modo que las tres coinciden en qué es una etiqueta válida. Duplicar
 * la normalización en cada componente es cómo se acaba con `Concierto` y
 * `concierto` conviviendo en el mismo evento.
 */

/** De cero a diez etiquetas por evento (F6). */
export const MAX_TAGS = 10;

/**
 * Máximo por etiqueta, en **unidades UTF-16** — o sea, en lo que mide
 * `String.length`.
 *
 * Se midió en puntos de código y era un error de tres capas: el `maxlength` de
 * `wa-input` cuenta unidades UTF-16, y el `size()` de las reglas de Firestore
 * también (comprobado contra el emulador: 280 `a` pasan, 281 no; 140 emoji
 * pasan, 150 no). Sólo esta constante contaba puntos de código, así que diez
 * etiquetas de 24 emoji —válidas aquí— sumaban 489 unidades y las reglas las
 * denegaban con un «no se pudo guardar» que no explicaba nada.
 *
 * Con las tres capas midiendo lo mismo, diez etiquetas de 24 más nueve
 * separadores son 249 y el tope agregado de las reglas nunca se alcanza por
 * las buenas. El coste es que una etiqueta de sólo emoji admite doce y no
 * veinticuatro, que es justo lo que el campo ya dejaba teclear.
 */
export const MAX_TAG_LENGTH = 24;

/**
 * Una etiqueta normalizada, o `null` si el texto no da para una.
 *
 * Se devuelve `null` en vez de recortar a 24 porque truncar destroza la
 * palabra en silencio —«conciertos de música clásica» se quedaría en
 * «conciertos de música clá»— y el usuario no se entera de que ha guardado
 * otra cosa. Quien llama decide: el editor avisa, `normalizeTags` descarta.
 *
 * La longitud se mide como `String.length`; el porqué está en
 * `MAX_TAG_LENGTH`.
 */
export function normalizeTag(raw: string): string | null {
	// Los espacios interiores se colapsan además de recortarse los extremos:
	// «música  clásica» y «música clásica» son la misma etiqueta para el
	// usuario, y sin esto la deduplicación no las junta.
	const clean = raw.trim().replace(/\s+/gu, " ").toLowerCase();
	if (clean === "") return null;
	if (clean.length > MAX_TAG_LENGTH) return null;
	return clean;
}

/**
 * Normaliza y deduplica **sin acotar cuántas hay**, conservando el primer
 * orden de aparición.
 *
 * Separada de `normalizeTags` porque el tope de cardinalidad es del contrato
 * *por evento* y no de la normalización. Aplicárselo al vocabulario del
 * usuario —la unión de las etiquetas de todos sus eventos, que no tiene cota—
 * truncaba la lista antes de filtrarla y dejaba el autocompletado ciego a
 * partir de la undécima etiqueta conocida.
 */
function cleanTags(raw: readonly string[]): string[] {
	const output: string[] = [];
	const seen = new Set<string>();
	for (const input of raw) {
		const tag = normalizeTag(input);
		if (tag === null || seen.has(tag)) continue;
		seen.add(tag);
		output.push(tag);
	}
	return output;
}

/**
 * Normaliza la lista de etiquetas **de un evento**: descarta lo que no vale,
 * deduplica conservando el primer orden de aparición y corta en `MAX_TAGS`.
 *
 * Esta es la puerta por la que pasa todo lo que no ha escrito una persona —lo
 * que propone la IA (T24), lo que trae un documento heredado— así que descarta
 * en silencio en lugar de fallar: un evento con una etiqueta imposible se
 * muestra sin ella, no deja de mostrarse.
 *
 * No sirve como saneador genérico: el corte en `MAX_TAGS` sólo tiene sentido
 * sobre las etiquetas de un evento. Para una lista sin cota, `cleanTags`.
 */
export function normalizeTags(raw: readonly string[]): string[] {
	return cleanTags(raw).slice(0, MAX_TAGS);
}

/**
 * Tono en grados (0–359) derivado del nombre, estable entre recargas.
 *
 * Devuelve un tono y no un color porque el contraste no puede depender del
 * hash: quien pinta fija luminosidad y croma desde los tokens del tema y sólo
 * gira el tono, y así las diez etiquetas cumplen AA por construcción en vez de
 * por suerte. Sortear también la luminosidad es cómo se acaba con una etiqueta
 * amarilla ilegible sobre blanco.
 *
 * FNV-1a de 32 bits: barato, sin dependencias y bien repartido para cadenas
 * cortas. No es criptográfico y no le hace falta serlo.
 */
export function tagHue(tag: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < tag.length; i++) {
		hash ^= tag.charCodeAt(i);
		// Multiplicación por el primo 16777619 en aritmética de 32 bits sin
		// signo. `Math.imul` es lo que evita perder precisión al pasar de 2^53.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash % 360;
}

/**
 * Las etiquetas ya usadas que encajan con lo que se está escribiendo, para el
 * autocompletado del editor.
 *
 * Coincide por subcadena y no sólo por prefijo: con etiquetas compuestas
 * —«música clásica»— buscar por prefijo obliga a recordar por dónde empieza.
 * Las que ya están puestas se excluyen: ofrecer lo que no se puede añadir es
 * ruido.
 *
 * `known` es el vocabulario del usuario —la unión de las etiquetas de todos
 * sus eventos—, así que se sanea con `cleanTags` y no con `normalizeTags`: el
 * tope de diez es del evento, y aplicarlo aquí recortaba el vocabulario antes
 * de buscar en él. Lo único acotado es cuántas sugerencias se ofrecen, y de eso
 * ya se encarga `limit`.
 */
export function suggestTags(
	known: readonly string[],
	query: string,
	already: readonly string[] = [],
	limit = 5,
): string[] {
	const term = normalizeTag(query) ?? query.trim().toLowerCase();
	const chosen = new Set(already);

	return cleanTags(known)
		.filter((tag) => !chosen.has(tag) && (term === "" || tag.includes(term)))
		.sort((a, b) => {
			// Lo que empieza por el término va antes que lo que sólo lo contiene:
			// es lo que el usuario está tecleando.
			const byPrefix = Number(b.startsWith(term)) - Number(a.startsWith(term));
			return byPrefix !== 0 ? byPrefix : a.localeCompare(b);
		})
		.slice(0, limit);
}
