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
			/**
			 * Who can see the event, its owner included. This is what the
			 * listing queries with `array-contains`, so an event without it is
			 * an invisible event. See ADR 0006.
			 */
			memberIds: z.array(z.string()).default([]),
			/**
			 * Each guest's role. The owner is absent here: their authority comes
			 * from `userId`, and giving them a role entry as well would open the
			 * door to demoting them.
			 */
			roles: z.record(z.string(), z.enum(["viewer", "editor"])).default({}),
			createdAt: z.coerce.date().nullable().optional(),
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

/** A guest's role. The owner carries none: they are one by `userId`. */
export type EventRole = "viewer" | "editor";

/** Un evento tal y como vive en Firestore: las fechas son Timestamp. */
export type PlanuEventDocument = Omit<
	PlanuEvent,
	"id" | "startDate" | "endDate" | "createdAt"
> & {
	startDate: Timestamp | null;
	endDate: Timestamp | null;
	createdAt?: Timestamp | null;
	imageUrl?: string | null;
};

/** Un evento ya leído de Firestore, con su identificador. */
export type StoredEvent = PlanuEvent & { id: string };
