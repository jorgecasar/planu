/**
 * Opens a session on the Auth emulator for the seed, with the email already
 * verified: `firestore.rules` requires `isVerified()` to write events, so a
 * fresh account would get every write denied.
 *
 * The emulator accepts `Bearer owner` as admin credentials, which is what
 * lets `accounts:update` set `emailVerified`. The token from the first
 * sign-in predates that change, so it signs in again for one that carries
 * the `email_verified` claim.
 */
export const AUTH_EMULATOR =
	"http://localhost:9099/identitytoolkit.googleapis.com/v1";

async function json(fetchFn, url, body, headers = {}) {
	const response = await fetchFn(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(
			`${response.status} ${url}\n${JSON.stringify(payload, null, 2)}`,
		);
	}
	return payload;
}

export async function openVerifiedSession({
	email,
	password,
	fetchFn = globalThis.fetch,
	auth = AUTH_EMULATOR,
	log = console.log,
}) {
	const credentials = { email, password, returnSecureToken: true };
	const signIn = () =>
		json(fetchFn, `${auth}/accounts:signInWithPassword?key=fake-api-key`, {
			...credentials,
		});
	let account;
	try {
		account = await json(
			fetchFn,
			`${auth}/accounts:signUp?key=fake-api-key`,
			credentials,
		);
		log(`usuario creado: ${email}`);
	} catch (error) {
		if (!String(error).includes("EMAIL_EXISTS")) throw error;
		account = await signIn();
	}
	await json(
		fetchFn,
		`${auth}/accounts:update`,
		{ localId: account.localId, emailVerified: true },
		{ Authorization: "Bearer owner" },
	);
	const { idToken, localId } = await signIn();
	return { idToken, localId };
}
