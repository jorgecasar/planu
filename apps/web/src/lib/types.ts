import type { Timestamp } from "firebase/firestore";
import { z } from "zod";

export const EventSchema = z
	.object({
		id: z.string().optional(),
		title: z
			.string()
			.min(3, { message: "Title must be at least 3 characters." }),
		description: z.string().optional(),
		location: z.string().optional(),
		startDate: z.coerce.date().nullable().optional(),
		endDate: z.coerce.date().nullable().optional(),
		imageUrl: z
			.string()
			.url({ message: "Must be a valid URL." })
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
			message: "End date cannot be earlier than start date.",
			path: ["endDate"],
		},
	);

/**
 * En el prototipo este tipo se llamaba `Event` y tapaba al `Event` del DOM en
 * todos los componentes, con errores de tipos difíciles de leer. Renombrado.
 */
export type PlanuEvent = z.infer<typeof EventSchema>;

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
