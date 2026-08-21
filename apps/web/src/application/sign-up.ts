import { signUpSchema } from "../auth/schemas.js";
import type { SessionPort } from "./ports/session.js";

/**
 * Validates the sign-up — including the password confirmation — and creates
 * the account. Sending the verification email is the adapter's job: here
 * only the credentials need to be valid before touching the port.
 */
export async function signUp(
	session: SessionPort,
	values: Record<string, string>,
): Promise<void> {
	const parsed = signUpSchema().safeParse(values);
	if (!parsed.success) throw parsed.error;

	await session.signUp(parsed.data.email, parsed.data.password);
}
