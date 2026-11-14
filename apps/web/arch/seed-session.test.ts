import { describe, expect, test } from "vitest";

/**
 * The seed must work with a fresh account: `firestore.rules` requires
 * `isVerified()`, so the session it writes with has to carry a token issued
 * after the email was marked verified. Fakes `fetch`, so no emulator.
 */

type Call = { url: string; body: Record<string, unknown>; auth?: string };

const { openVerifiedSession } = await import(
	new URL("../../../scripts/seed-session.js", import.meta.url).href
);

function fakeAuth({ exists }: { exists: boolean }) {
	const calls: Call[] = [];
	let verified = false;
	let issued = 0;
	const fetchFn = async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		const headers = init.headers as Record<string, string>;
		const auth = headers["Authorization"];
		calls.push({ url, body, ...(auth ? { auth } : {}) });
		const reply = (status: number, payload: unknown) =>
			new Response(JSON.stringify(payload), { status });
		if (url.includes("accounts:signUp")) {
			return exists
				? reply(400, { error: { message: "EMAIL_EXISTS" } })
				: reply(200, { localId: "u1", idToken: `t${++issued}-${verified}` });
		}
		if (url.includes("accounts:signInWithPassword")) {
			return reply(200, { localId: "u1", idToken: `t${++issued}-${verified}` });
		}
		if (url.includes("accounts:update")) {
			if (headers["Authorization"] !== "Bearer owner") return reply(401, {});
			verified = body["emailVerified"] === true;
			return reply(200, { localId: body["localId"] });
		}
		return reply(404, {});
	};
	return { calls, fetchFn };
}

describe("openVerifiedSession", () => {
	test.each([
		["una cuenta nueva", false],
		["una cuenta existente", true],
	])("verifica %s y devuelve un token posterior", async (_, exists) => {
		const { calls, fetchFn } = fakeAuth({ exists });
		const session = await openVerifiedSession({
			email: "a@example.com",
			password: "secret123",
			fetchFn,
			log: () => {},
		});
		const update = calls.find((c) => c.url.includes("accounts:update"));
		expect(update).toMatchObject({
			body: { localId: "u1", emailVerified: true },
			auth: "Bearer owner",
		});
		expect(session.localId).toBe("u1");
		expect(session.idToken).toMatch(/-true$/);
	});

	test("propaga un error que no sea EMAIL_EXISTS", async () => {
		const urls: string[] = [];
		const fetchFn = async (url: string) => {
			urls.push(url);
			return new Response(JSON.stringify({ error: { message: "OTHER" } }), {
				status: 400,
			});
		};
		await expect(
			openVerifiedSession({ email: "a@x.com", password: "p", fetchFn }),
		).rejects.toThrow(/OTHER/);
		expect(urls).toEqual([expect.stringContaining("accounts:signUp")]);
	});
});
