import { msg } from "@lit/localize";
import { z } from "zod";

/**
 * Factories and not constants: the messages are interface, and a schema
 * created at module import time would be stuck with the language of that
 * instant.
 *
 * Firebase requires at least 6 characters; we validate beforehand to avoid a
 * round trip.
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
