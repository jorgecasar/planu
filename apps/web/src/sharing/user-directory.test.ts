import { expect, test } from "vitest";
import { emailHash } from "./user-directory.js";

/**
 * The expected values are SHA-256 digests computed outside the application.
 * They have to match what `hashing.sha256()` produces in the Firestore rules:
 * if the two ever diverge, nobody can find anybody by email.
 */
const ANA_HASH =
	"8e43ca37701228e74983efdbd0cff5c16b3b1e5d4e29a7c05626d4d25a018e11";

test("hashes a known email to the expected digest", async () => {
	expect(await emailHash("ana@example.com")).toBe(ANA_HASH);
});

test("normalises case and surrounding spaces before hashing", async () => {
	// Whoever invites types the address by hand: unnormalised,
	// "Ana@Example.com " would not find the same person as "ana@example.com".
	expect(await emailHash("ANA@Example.com  ")).toBe(ANA_HASH);
	expect(await emailHash("  Ana@EXAMPLE.com")).toBe(ANA_HASH);
});

test("different emails hash differently", async () => {
	expect(await emailHash("other@example.com")).not.toBe(ANA_HASH);
});

test("always returns 64 lowercase hex characters", async () => {
	// The rule compares against `.toHexString().lower()`: a single uppercase
	// character would break the comparison outright.
	const hash = await emailHash("Someone@Example.com");
	expect(hash).toMatch(/^[0-9a-f]{64}$/);
});
