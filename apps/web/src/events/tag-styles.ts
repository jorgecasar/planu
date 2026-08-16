import { css } from "lit";

/**
 * El aspecto de una etiqueta, compartido por la tarjeta y por el editor.
 *
 * Vivía sólo en la tarjeta, y el resultado fue que las etiquetas del editor se
 * pintaban con el neutro por defecto de Web Awesome: **4,42:1**, por debajo del
 * 4,5:1 que exige AA. Lo encontró axe en el e2e, no una revisión visual.
 *
 * El nombre de la etiqueta gira el tono y nada más. La luminosidad y el croma
 * son constantes, así que el contraste es el mismo para las diez y no depende
 * de qué palabra escribió el usuario: medido recorriendo los 360 tonos, el peor
 * caso es 8,03:1. Éstas son las tres propiedades que `wa-tag` lee de verdad,
 * comprobado en su hoja de estilos y no supuesto.
 *
 * Sin variante oscura a propósito: el tema oscuro de Web Awesome es opt-in por
 * clase y nadie la pone, así que una consulta de preferencia del sistema
 * pintaría chips negros dentro de una tarjeta clara.
 */
export const tagChipStyles = css`
	wa-tag {
		--wa-color-fill-quiet: oklch(0.94 0.045 var(--hue));
		--wa-color-on-quiet: oklch(0.38 0.08 var(--hue));
		--wa-color-border-normal: oklch(0.86 0.06 var(--hue));
	}
`;
