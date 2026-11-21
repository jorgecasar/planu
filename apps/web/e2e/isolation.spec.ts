import { expect, test } from "./fixtures.js";
import { API_KEY, AUTH_EMULATOR } from "./verified-account.js";

const FIRESTORE =
	"http://127.0.0.1:8181/v1/projects/planu-app/databases/planu/documents";
const email = "left-behind@example.com";
// Throwaway credential for a local emulator, built at run time on purpose.
const password = `pw-${crypto.randomUUID()}`;

// The two tests are one check split in two on purpose: the second can only
// pass if the fixture wiped what the first left behind in the emulators.
test.describe.configure({ mode: "serial" });

test("a test leaves an account and a document behind", async ({ request }) => {
	const signUp = await request.post(
		`${AUTH_EMULATOR}/accounts:signUp?key=${API_KEY}`,
		{
			data: { email, password, returnSecureToken: true },
		},
	);
	expect(signUp.ok()).toBe(true);

	const write = await request.post(`${FIRESTORE}/isolation`, {
		headers: { Authorization: "Bearer owner" },
		data: { fields: { left: { booleanValue: true } } },
	});
	expect(write.ok()).toBe(true);
});

test("the next test starts with no accounts and no documents", async ({
	request,
}) => {
	const signIn = await request.post(
		`${AUTH_EMULATOR}/accounts:signInWithPassword?key=${API_KEY}`,
		{ data: { email, password, returnSecureToken: true } },
	);
	expect(signIn.status()).toBe(400);
	expect((await signIn.json()).error.message).toBe("EMAIL_NOT_FOUND");

	const documents = await request.get(`${FIRESTORE}/isolation`, {
		headers: { Authorization: "Bearer owner" },
	});
	expect((await documents.json()).documents ?? []).toEqual([]);
});
