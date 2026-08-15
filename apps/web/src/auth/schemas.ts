import { z } from "zod";

/** Firebase exige 6 caracteres como mínimo; validamos antes para no ir y volver. */
export const credentialsSchema = z.object({
	email: z.email({ message: "Enter a valid email address." }),
	password: z
		.string()
		.min(6, { message: "Password must be at least 6 characters." }),
});

export const signUpSchema = credentialsSchema
	.extend({ confirmPassword: z.string() })
	.refine((values) => values.password === values.confirmPassword, {
		message: "Passwords don't match.",
		path: ["confirmPassword"],
	});

export type Credentials = z.infer<typeof credentialsSchema>;
export type SignUp = z.infer<typeof signUpSchema>;
