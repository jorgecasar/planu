/**
 * What a person can download about themselves (GDPR art. 15 and 20).
 *
 * Pure: it shapes what an adapter read with the person's own permissions, and
 * nothing of somebody else ends up in the file. Events are the owned ones, not
 * the shared ones; invitations keep only id, event and role.
 */

export const ACCOUNT_EXPORT_FORMAT = "planu-account-export";
export const ACCOUNT_EXPORT_VERSION = 1;

/** One event as the adapter read it; `isOwner` is false for a shared one. */
export interface ExportEventSource {
	id: string;
	isOwner: boolean;
	fields: Record<string, unknown>;
}

/** An invitation as read; extra fields (the other person's) are dropped. */
export type ExportInviteSource = {
	id: string;
	eventId: string;
	role: string;
} & Record<string, unknown>;

export interface PublicCard {
	displayName: string;
	photoURL: string;
}
export interface AccountExportSource {
	uid: string;
	email: string | null;
	displayName: string | null;
	profile: PublicCard | null;
	directoryEntry: PublicCard | null;
	events: ExportEventSource[];
	sentInvites: ExportInviteSource[];
	receivedInvites: ExportInviteSource[];
}

export interface ExportInvite {
	id: string;
	eventId: string;
	role: string;
}

export interface AccountExport {
	format: typeof ACCOUNT_EXPORT_FORMAT;
	version: typeof ACCOUNT_EXPORT_VERSION;
	exportedAt: string;
	account: { uid: string; email: string | null; displayName: string | null };
	profile: PublicCard | null;
	directoryEntry: PublicCard | null;
	events: Array<{ id: string; data: Record<string, unknown> }>;
	invitations: { sent: ExportInvite[]; received: ExportInvite[] };
}

const ownInvite = ({
	id,
	eventId,
	role,
}: ExportInviteSource): ExportInvite => ({
	id,
	eventId,
	role,
});

export function buildAccountExport(
	source: AccountExportSource,
	now: Date,
): AccountExport {
	return {
		format: ACCOUNT_EXPORT_FORMAT,
		version: ACCOUNT_EXPORT_VERSION,
		exportedAt: now.toISOString(),
		account: {
			uid: source.uid,
			email: source.email,
			displayName: source.displayName,
		},
		profile: source.profile,
		directoryEntry: source.directoryEntry,
		events: source.events
			.filter((event) => event.isOwner)
			.map(({ id, fields }) => ({ id, data: fields })),
		invitations: {
			sent: source.sentInvites.map(ownInvite),
			received: source.receivedInvites.map(ownInvite),
		},
	};
}
