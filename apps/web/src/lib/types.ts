import { msg } from "@lit/localize";
import type { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * Fábrica y no constante: los mensajes de validación son interfaz y deben
 * traducirse, así que se construyen al usar el esquema, no al importarlo.
 */
export const eventSchema = () =>
	z
		.object({
			id: z.string().optional(),
			title: z
				.string()
				.min(3, { message: msg("Title must be at least 3 characters.") }),
			description: z.string().optional(),
			location: z.string().optional(),
			startDate: z.coerce.date().nullable().optional(),
			endDate: z.coerce.date().nullable().optional(),
			imageUrl: z
				.string()
				.url({ message: msg("Must be a valid URL.") })
				.optional()
				.or(z.literal("")),
			userId: z.string().optional(),
		})
		.refine(
			(data) => {
				if (data.startDate && data.endDate) {
					return data.startDate <= data.endDate;
				}
				return true;
			},
			{
				message: msg("End date cannot be earlier than start date."),
				path: ["endDate"],
			},
		);

/**
 * En el prototipo este tipo se llamaba `Event` y tapaba al `Event` del DOM en
 * todos los componentes, con errores de tipos difíciles de leer. Renombrado.
 */
export type PlanuEvent = z.infer<ReturnType<typeof eventSchema>>;

/** Un evento tal y como vive en Firestore: las fechas son Timestamp. */
export type PlanuEventDocument = Omit<
	PlanuEvent,
	"id" | "startDate" | "endDate"
> & {
	startDate: Timestamp | null;
	endDate: Timestamp | null;
	imageUrl?: string | null;
};

/** Un evento ya leído de Firestore, con su identificador. */
export type StoredEvent = PlanuEvent & { id: string };
