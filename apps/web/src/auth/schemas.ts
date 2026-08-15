import { msg } from "@lit/localize";
import { z } from "zod";

/**
 * Fábricas y no constantes: los mensajes son interfaz, y un esquema creado al
 * importar el módulo se quedaría con el idioma de ese instante.
 *
 * Firebase exige 6 caracteres como mínimo; validamos antes para no ir y volver.
 */
export const credentialsSchema = () =>
	z.object({
		email: z.email({ message: msg("Enter a valid email address.") }),
		password: z
			.string()
			.min(6, { message: msg("Password must be at least 6 characters.") }),
	});

export const signUpSchema = () =>
	credentialsSchema()
		.extend({ confirmPassword: z.string() })
		.refine((values) => values.password === values.confirmPassword, {
			message: msg("Passwords don't match."),
			path: ["confirmPassword"],
		});

export type Credentials = z.infer<ReturnType<typeof credentialsSchema>>;
export type SignUp = z.infer<ReturnType<typeof signUpSchema>>;
