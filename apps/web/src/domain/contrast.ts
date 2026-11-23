/** WCAG 2.1 contrast maths (relative luminance and contrast ratio). */

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function channel(value: number): number {
	const s = value / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
	const match = HEX_COLOR.exec(hex);
	if (!match?.[1]) {
		throw new Error(`Expected a #rrggbb colour, got ${hex}`);
	}
	const n = Number.parseInt(match[1], 16);
	return (
		0.2126 * channel((n >> 16) & 255) +
		0.7152 * channel((n >> 8) & 255) +
		0.0722 * channel(n & 255)
	);
}

/** Contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
