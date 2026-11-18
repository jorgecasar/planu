import { ContextConsumer } from "@lit/context";
import { getApps } from "firebase/app";
import { LitElement } from "lit";
import { afterEach, expect, test, vi } from "vitest";

/**
 * `config.ts` reads these when it is imported, so they are set before the
 * imports below run (`vi.hoisted`). Without a key Firebase refuses to start
 * with `auth/invalid-api-key`, and what the test would measure is whether
 * this machine has a `.env.local`. They are the same placeholders CI uses
 * for the emulators; nothing here talks to the network.
 */
vi.hoisted(() => {
	const env = {
		VITE_FIREBASE_API_KEY: "demo-api-key",
		VITE_FIREBASE_AUTH_DOMAIN: "planu-app.firebaseapp.com",
		VITE_FIREBASE_PROJECT_ID: "planu-app",
		VITE_FIREBASE_STORAGE_BUCKET: "planu-app.firebasestorage.app",
		VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
		VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000000000",
	};
	for (const [name, value] of Object.entries(env)) {
		(import.meta.env as Record<string, string>)[name] = value;
	}
});

import {
	eventsContext,
	eventsInterestContext,
	sessionContext,
	userContext,
} from "../../application/context.js";
import {
	analyticsContext,
	noopAnalytics,
} from "../../application/ports/analytics.js";
import { firebaseConfig } from "./config.js";
import {
	initializeFirebase,
	loadDataServices,
	type PlanuFirebaseProvider,
} from "./firebase-provider.js";
import { FirebaseSessionAdapter } from "./session-adapter.js";

/**
 * Reads what the provider publishes the way the application does: through
 * context, from an element inside it. No emulator is needed for any of this:
 * nothing here signs in, so Auth settles on «no session» from local storage
 * and Firestore is never asked for data.
 */
class Probe extends LitElement {
	readonly user = new ContextConsumer(this, {
		context: userContext,
		subscribe: true,
	});
	readonly session = new ContextConsumer(this, {
		context: sessionContext,
		subscribe: true,
	});
	readonly analytics = new ContextConsumer(this, {
		context: analyticsContext,
		subscribe: true,
	});
	readonly events = new ContextConsumer(this, {
		context: eventsContext,
		subscribe: true,
	});
	readonly interest = new ContextConsumer(this, {
		context: eventsInterestContext,
		subscribe: true,
	});
}
customElements.define("planu-provider-probe", Probe);

const mounted: PlanuFirebaseProvider[] = [];

function mount(): { provider: PlanuFirebaseProvider; probe: Probe } {
	const provider = document.createElement(
		"planu-firebase-provider",
	) as PlanuFirebaseProvider;
	const probe = document.createElement("planu-provider-probe") as Probe;
	provider.append(probe);
	document.body.append(provider);
	mounted.push(provider);
	return { provider, probe };
}

afterEach(() => {
	for (const provider of mounted.splice(0)) provider.remove();
});

test("initializeFirebase builds the app once and hands back the same services", () => {
	const first = initializeFirebase();
	const second = initializeFirebase();

	expect(second).toBe(first);
	expect(first.app.options.projectId).toBe(firebaseConfig.projectId);
	expect(first.auth.app).toBe(first.app);
	// One app registered in the SDK, not one per call: a second one would mean
	// two Auth services fighting over the same persisted session.
	expect(getApps()).toEqual([first.app]);
});

test("loadDataServices memoizes the promise, so the emulators are connected once", async () => {
	const { app } = initializeFirebase();

	const first = loadDataServices(app);
	const second = loadDataServices(app);
	expect(second).toBe(first);

	const { firestore, storage } = await first;
	expect(firestore.app).toBe(app);
	expect(storage.app).toBe(app);
});

test("the provider publishes the session adapter and the event-interest switch", async () => {
	const { probe } = mount();
	await probe.updateComplete;

	expect(probe.session.value).toBeInstanceOf(FirebaseSessionAdapter);
	expect(typeof probe.interest.value).toBe("function");
});

test("analytics is the no-op from the first read: it does not wait for a session", () => {
	const { probe } = mount();

	// Read right away, no await: the real adapter arrives later and can also
	// turn out to be the no-op, which would hide a provider with no initial value.
	expect(probe.analytics.value).toBe(noopAnalytics);
});

test("with no stored session Auth answers and the user becomes null", async () => {
	const { probe } = mount();

	await vi.waitFor(() => expect(probe.user.value).toBeNull());
});

test("with no session the listing is ready and empty, not loading", async () => {
	const { probe } = mount();

	await vi.waitFor(() =>
		expect(probe.events.value).toEqual({ status: "ready", events: [] }),
	);
});

test("republishing an unchanged snapshot keeps the same object", async () => {
	const { provider, probe } = mount();
	await vi.waitFor(() => expect(probe.user.value).toBeNull());
	const before = probe.events.value;

	// Asking for a render with nothing new must not hand consumers a new
	// snapshot: that would re-render every view on the page.
	provider.requestUpdate();
	await provider.updateComplete;
	probe.interest.value?.(true);
	await provider.updateComplete;

	expect(probe.events.value).toBe(before);
});

test("removing the provider stops listening to Auth", async () => {
	const { provider, probe } = mount();
	await vi.waitFor(() => expect(probe.user.value).toBeNull());

	expect(() => provider.remove()).not.toThrow();
	expect(provider.isConnected).toBe(false);
});
