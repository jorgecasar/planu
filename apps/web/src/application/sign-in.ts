import { credentialsSchema } from "../auth/schemas.js";
import type { SessionPort } from "./ports/session.js";

/**
 * Valida las credenciales y entra. La validación vive aquí y no en el
 * componente para que sea comprobable sin montar un formulario: un `ZodError`
 * sale sin llegar a tocar el puerto.
 */
export async function signIn(
	session: SessionPort,
	values: Record<string, string>,
): Promise<void> {
	const parsed = credentialsSchema().safeParse(values);
	if (!parsed.success) throw parsed.error;

	await session.signIn(parsed.data.email, parsed.data.password);
}
