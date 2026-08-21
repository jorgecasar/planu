import { signUpSchema } from "../auth/schemas.js";
import type { SessionPort } from "./ports/session.js";

/**
 * Valida el alta —incluida la confirmación de contraseña— y crea la cuenta.
 * El envío del correo de verificación es cosa del adaptador: aquí sólo
 * importa que las credenciales sean válidas antes de tocar el puerto.
 */
export async function signUp(
	session: SessionPort,
	values: Record<string, string>,
): Promise<void> {
	const parsed = signUpSchema().safeParse(values);
	if (!parsed.success) throw parsed.error;

	await session.signUp(parsed.data.email, parsed.data.password);
}
