/**
 * The message a person sends to someone they invited to an event.
 *
 * planu sends nothing by itself (ADR 0012): the owner shares the invitation
 * through their own mail client, the clipboard or the system share sheet.
 * This builds the text and the `mailto:` link; it reads no account data and
 * says nothing about whether the invited address has an account.
 */

import { msg, str } from "@lit/localize";
import type { EventRole } from "../lib/types.js";

export interface InvitationMessageInput {
	/** Title of the event the person was invited to. */
	eventTitle: string;
	/** Link to sign in or sign up; carries no email and grants no access. */
	link: string;
	/** What the invited person can do. */
	role: EventRole;
	/** The address the owner typed, to prefill the recipient. */
	to?: string;
}

export interface InvitationMessage {
	subject: string;
	body: string;
	/** `mailto:` link with subject and body encoded. */
	mailto: string;
}

function roleText(role: EventRole): string {
	return role === "editor" ? msg("an editor") : msg("a viewer");
}

/** Characters that would let a title or address break out of a header. */
function oneLine(text: string): string {
	return text.replace(/[\r\n]+/g, " ").trim();
}

export function buildInvitationMessage(
	input: InvitationMessageInput,
): InvitationMessage {
	const title = oneLine(input.eventTitle);
	const subject = msg(str`Invitation to “${title}” on planu`);
	const body = [
		msg(str`I invited you to “${title}” as ${roleText(input.role)}.`),
		msg("Sign in with this email address to see it and accept:"),
		input.link,
	].join("\r\n\r\n");

	const recipient = input.to ? encodeURIComponent(oneLine(input.to)) : "";
	const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

	return { subject, body, mailto };
}
