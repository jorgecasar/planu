import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	setDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const ANA = { uid: "ana-uid", email: "ana@example.com" };
const ATTACKER = { uid: "attacker-uid", email: "attacker@example.com" };

const hash = (email: string) =>
	createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

const entry = (uid: string) => ({
	uid,
	displayName: "Ana",
	photoURL: "https://lh3.googleusercontent.com/a/ana",
});

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-directory-test",
		firestore: {
			host: "localhost",
			port: 8181,
			rules: readFileSync("../../firestore.rules", "utf8"),
		},
	});
});

afterAll(async () => {
	await env?.cleanup();
});

beforeEach(async () => {
	await env.clearFirestore();
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(
			doc(ctx.firestore(), `userDirectory/${hash(ANA.email)}`),
			entry(ANA.uid),
		);
	});
});

/** A session with a verified email, the only kind the directory accepts. */
const as = (who: { uid: string; email: string }, verified = true) =>
	env
		.authenticatedContext(who.uid, {
			email: who.email,
			email_verified: verified,
		})
		.firestore();

describe("publishing your own entry", () => {
	test("with a verified email, writes to its own email hash", async () => {
		await assertSucceeds(
			setDoc(
				doc(as(ATTACKER), `userDirectory/${hash(ATTACKER.email)}`),
				entry(ATTACKER.uid),
			),
		);
	});

	test("without a verified email, cannot publish", async () => {
		// Firebase Auth lets anyone register with any address without checking
		// it. Without this condition, signing up with someone else's email would
		// be enough to collect their invitations.
		await assertFails(
			setDoc(
				doc(as(ATTACKER, false), `userDirectory/${hash(ATTACKER.email)}`),
				entry(ATTACKER.uid),
			),
		);
	});

	test("cannot write to another person's email hash", async () => {
		await assertFails(
			setDoc(
				doc(as(ATTACKER), `userDirectory/${hash(ANA.email)}`),
				entry(ATTACKER.uid),
			),
		);
	});

	test("cannot publish a uid that is not their own", async () => {
		await assertFails(
			setDoc(
				doc(as(ATTACKER), `userDirectory/${hash(ATTACKER.email)}`),
				entry(ANA.uid),
			),
		);
	});

	test("cannot use its entry as a data store", async () => {
		await assertFails(
			setDoc(doc(as(ATTACKER), `userDirectory/${hash(ATTACKER.email)}`), {
				...entry(ATTACKER.uid),
				relleno: "x".repeat(100 * 1024),
			}),
		);
	});

	test("without a session nothing is published", async () => {
		await assertFails(
			setDoc(
				doc(
					env.unauthenticatedContext().firestore(),
					`userDirectory/${hash(ATTACKER.email)}`,
				),
				entry(ATTACKER.uid),
			),
		);
	});
});

describe("looking up who to invite", () => {
	test("anyone signed in can resolve one specific email", async () => {
		await assertSucceeds(
			getDoc(doc(as(ATTACKER), `userDirectory/${hash(ANA.email)}`)),
		);
	});

	test("nobody can list the whole directory", async () => {
		// This is what separates checking an address you already know from
		// downloading the user census.
		await assertFails(getDocs(collection(as(ATTACKER), "userDirectory")));
	});

	test("without a session no email resolves", async () => {
		await assertFails(
			getDoc(
				doc(
					env.unauthenticatedContext().firestore(),
					`userDirectory/${hash(ANA.email)}`,
				),
			),
		);
	});
});

describe("removing yourself from the directory", () => {
	test("each person deletes their own entry", async () => {
		await assertSucceeds(
			deleteDoc(doc(as(ANA), `userDirectory/${hash(ANA.email)}`)),
		);
	});

	test("nobody deletes someone else's entry", async () => {
		await assertFails(
			deleteDoc(doc(as(ATTACKER), `userDirectory/${hash(ANA.email)}`)),
		);
	});
});

describe("the by-uid index used to show guests", () => {
	test("each person publishes their own profile", async () => {
		await assertSucceeds(
			setDoc(doc(as(ANA), `userProfiles/${ANA.uid}`), {
				displayName: "Ana",
				photoURL: "",
			}),
		);
	});

	test("nobody publishes someone else's profile", async () => {
		await assertFails(
			setDoc(doc(as(ATTACKER), `userProfiles/${ANA.uid}`), {
				displayName: "Fake Ana",
				photoURL: "",
			}),
		);
	});

	test("anyone signed in can resolve one specific uid", async () => {
		await assertSucceeds(getDoc(doc(as(ATTACKER), `userProfiles/${ANA.uid}`)));
	});

	test("nobody can list the profiles", async () => {
		await assertFails(getDocs(collection(as(ATTACKER), "userProfiles")));
	});

	test("the profile accepts neither the email nor filler", async () => {
		// If the email fitted here, sharing an event would hand out addresses.
		await assertFails(
			setDoc(doc(as(ATTACKER), `userProfiles/${ATTACKER.uid}`), {
				displayName: "Atacante",
				photoURL: "",
				email: ATTACKER.email,
			}),
		);
	});
});
