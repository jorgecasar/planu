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

export type Event = z.infer<typeof EventSchema>;

export type EventDocumentData = Omit<Event, "id" | "startDate" | "endDate"> & {
	startDate: Timestamp | null;
	endDate: Timestamp | null;
	imageUrl?: string | null;
};
