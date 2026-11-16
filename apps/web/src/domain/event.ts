import { msg } from "@lit/localize";
import { z } from "zod";
import { normalizeTags } from "../domain/tags.js";

/**
 * Factory and not a constant: validation messages are interface and must be
 * translated, so they are built when the schema is used, not when it is
 * imported.
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
			/**
			 * All-day flag. default(true): earlier events don't carry the
			 * field and all of them are all-day — the editor saved them at
			 * T00:00:00. With false as the default, every existing event
			 * would turn into a midnight appointment in the .ics.
			 */
			allDay: z.boolean().default(true),
			/**
			 * Free-form tags, normalized by `domain/tags.ts`.
			 *
			 * Sanitized instead of rejected, hence the `unknown`: this schema
			 * also validates what is read from Firestore, and there a `tags`
			 * with junk inside would drop the whole event from the listing. An
			 * impossible tag gets discarded; the event keeps showing.
			 *
			 * The `.optional()` is not decorative: in Zod 4 a bare `z.unknown()`
			 * accepts the key set to `undefined` but **not** it being missing,
			 * and that is exactly what events predating F6 bring —the same ones
			 * the rules bother to leave editable without `tags` in `hasAll`—.
			 * Without it, the resilience this comment promises depended on
			 * `toEvent` listing the key by hand: parsing a legacy document with
			 * a *spread* dropped all of them from the listing.
			 */
			tags: z
				.unknown()
				.optional()
				.transform((value) =>
					normalizeTags(
						Array.isArray(value)
							? value.filter((item): item is string => typeof item === "string")
							: [],
					),
				),
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
 * In the prototype this type was called `Event` and shadowed the DOM's
 * `Event` in every component, with hard-to-read type errors. Renamed.
 */
export type PlanuEvent = z.infer<ReturnType<typeof eventSchema>>;

/** A guest's role. The owner carries none: they are one by `userId`. */
export type EventRole = "viewer" | "editor";

/** An event already read from the repository, with its identifier. */
export type StoredEvent = PlanuEvent & { id: string };
