// The theme, as `main.ts` loads it: without it the radius tokens are unset
// and both sides of the comparison would be `0px`.
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import { expect, test } from "vitest";
import "./events-view.js";

test("while loading, the skeletons take the card's radius", async () => {
	// No provider answers the events context, so the listing stays loading.
	const el = document.createElement("planu-events-view") as HTMLElement & {
		updateComplete: Promise<boolean>;
	};
	document.body.append(el);
	await el.updateComplete;
	const skeleton = el.shadowRoot?.querySelector<
		HTMLElement & { updateComplete: Promise<boolean> }
	>(".grid wa-skeleton");
	await skeleton?.updateComplete;
	const indicator = skeleton?.shadowRoot?.querySelector('[part~="indicator"]');
	if (!indicator) throw new Error("no skeleton indicator");

	const card = document.createElement("div");
	card.style.borderRadius = "var(--wa-panel-border-radius)";
	document.body.append(card);
	const radius = getComputedStyle(card).borderTopLeftRadius;

	expect(radius).not.toBe("0px");
	expect(getComputedStyle(indicator).borderTopLeftRadius).toBe(radius);
	el.remove();
	card.remove();
});
