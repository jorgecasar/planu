import { afterEach, expect, test } from "vitest";
import { type ConsentStore, createConsentStore } from "../../domain/consent.js";
import type { PlanuConsentBanner } from "./consent-banner.js";
import "./consent-banner.js";

const memoryStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
};

const consentWith = (decision?: "granted" | "denied") => {
	const store = createConsentStore(memoryStorage());
	if (decision) store.set(decision);
	return store;
};

const mounted: PlanuConsentBanner[] = [];

async function mount(consent: ConsentStore): Promise<PlanuConsentBanner> {
	const el = document.createElement(
		"planu-consent-banner",
	) as PlanuConsentBanner;
	el.consent = consent;
	document.body.append(el);
	mounted.push(el);
	await el.updateComplete;
	return el;
}

afterEach(() => {
	for (const el of mounted.splice(0)) el.remove();
});

const buttonNamed = (el: PlanuConsentBanner, label: string) => {
	const found = Array.from(
		el.shadowRoot?.querySelectorAll("wa-button") ?? [],
	).find((b) => b.textContent?.trim() === label);
	if (!found) throw new Error(`no button named ${label}`);
	return found;
};

test("sin decisión se ofrece elegir, con un título que nombra la región", async () => {
	const el = await mount(consentWith());

	const region = el.shadowRoot?.querySelector("section[role='region']");
	expect(region).not.toBeNull();
	const titleId = region?.getAttribute("aria-labelledby") ?? "";
	expect(el.shadowRoot?.getElementById(titleId)?.textContent).toMatch(
		/privacy choices/i,
	);
});

test("aceptar guarda «granted» y el banner desaparece", async () => {
	const consent = consentWith();
	const el = await mount(consent);

	buttonNamed(el, "Accept").click();
	await el.updateComplete;

	expect(consent.get()).toBe("granted");
	expect(el.shadowRoot?.querySelector("section")).toBeNull();
});

test("rechazar guarda «denied» y el banner desaparece", async () => {
	const consent = consentWith();
	const el = await mount(consent);

	buttonNamed(el, "Refuse").click();
	await el.updateComplete;

	expect(consent.get()).toBe("denied");
	expect(el.shadowRoot?.querySelector("section")).toBeNull();
});
