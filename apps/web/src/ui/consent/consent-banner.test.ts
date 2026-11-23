import { afterEach, expect, test, vi } from "vitest";
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

	buttonNamed(el, "Allow").click();
	await el.updateComplete;

	expect(consent.get()).toBe("granted");
	expect(el.shadowRoot?.querySelector("section")).toBeNull();
});

test("rechazar guarda «denied» y el banner desaparece", async () => {
	const consent = consentWith();
	const el = await mount(consent);

	buttonNamed(el, "Do not allow").click();
	await el.updateComplete;

	expect(consent.get()).toBe("denied");
	expect(el.shadowRoot?.querySelector("section")).toBeNull();
});

test("aceptar y rechazar pesan lo mismo: mismo aspecto, variante y tamaño", async () => {
	const el = await mount(consentWith());

	const accept = buttonNamed(el, "Allow");
	const refuse = buttonNamed(el, "Do not allow");
	for (const attribute of ["variant", "appearance", "size"]) {
		expect(refuse.getAttribute(attribute)).toBe(accept.getAttribute(attribute));
	}
	expect(el.shadowRoot?.querySelectorAll("wa-button")).toHaveLength(2);
});

test("no hay nada marcado de antemano: ni casillas ni opciones", async () => {
	const el = await mount(consentWith());

	expect(
		el.shadowRoot?.querySelector(
			"input, wa-checkbox, wa-radio, wa-switch, [checked]",
		),
	).toBeNull();
});

test("con una decisión ya tomada no se muestra", async () => {
	for (const decision of ["granted", "denied"] as const) {
		const el = await mount(consentWith(decision));

		expect(el.shadowRoot?.querySelector("section")).toBeNull();
	}
});

test("vuelve a mostrarse si la decisión se borra, para poder cambiarla", async () => {
	const consent = consentWith("granted");
	const el = await mount(consent);
	expect(el.shadowRoot?.querySelector("section")).toBeNull();

	consent.clear();
	await el.updateComplete;

	expect(el.shadowRoot?.querySelector("section")).not.toBeNull();
});

test("al desmontarse deja de escuchar el almacén", async () => {
	const unsubscribe = vi.fn();
	const consent = consentWith();
	vi.spyOn(consent, "subscribe").mockReturnValue(unsubscribe);
	const el = await mount(consent);

	el.remove();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("enlaza a la política de privacidad", async () => {
	const el = await mount(consentWith());

	const link = el.shadowRoot?.querySelector("a");
	expect(link?.getAttribute("href")).toBe("/privacy.html");
});
