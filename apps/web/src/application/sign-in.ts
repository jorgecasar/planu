import { credentialsSchema } from "../auth/schemas.js";
import type { SessionPort } from "./ports/session.js";

/**
 * Validates the credentials and signs in. The validation lives here and
 * not in the component so it can be tested without mounting a form: a
 * `ZodError` comes out without ever touching the port.
 */
export async function signIn(
	session: SessionPort,
	values: Record<string, string>,
): Promise<void> {
	const parsed = credentialsSchema().safeParse(values);
	if (!parsed.success) throw parsed.error;

	await session.signIn(parsed.data.email, parsed.data.password);
}
