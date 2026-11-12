import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import { msg, str } from "@lit/localize";
import { html, nothing } from "lit";
import type { SessionUser } from "../application/ports/session.js";
import type { Person } from "./access-list.js";

// Plain templates, like `CoverField.render()`: they take the dialog's styles.

/** You, first and unchangeable. Seeing yourself listed makes the list read. */
export function renderOwner(user: SessionUser) {
	return html`
		<li>
			<wa-avatar
				image=${user.photoURL ?? ""}
				label=""
				aria-hidden="true"
			></wa-avatar>
			<span class="identity">
				<span class="name">${user.displayName || msg("You")}</span>
				<span class="detail">${user.email ?? ""}</span>
			</span>
			<span class="trailing">
				<span class="owner-role">${msg("Owner")}</span>
			</span>
		</li>
	`;
}

/**
 * One person, with everything you can do to them behind a single control.
 *
 * Role and removal live in the same menu rather than a select plus a button:
 * the button carried the person's name to be distinguishable, which made
 * every row a wall of repeated text.
 */
export function renderPerson(
	person: Person,
	busy: boolean,
	onAction: (person: Person, domEvent: Event) => void,
) {
	return html`
		<li>
			<wa-avatar
				image=${person.photoURL}
				label=""
				aria-hidden="true"
			></wa-avatar>
			<span class="identity">
				<span class="name">${person.name}</span>
				${
					// Only what the trailing control cannot say. Repeating the role
					// here made every row say it twice.
					//
					// The address goes on the rows that have not accepted yet, which
					// is exactly when the name is least useful: someone who has never
					// signed in has no published profile, so the row would read
					// "Guest" and identify nobody.
					person.pending
						? html`<span class="detail">${person.email}</span>`
						: nothing
				}
			</span>

			<span class="trailing">
				${
					// The state is a badge and not a line of text: it keeps every row
					// the same height, and it says the same thing about anyone —
					// there is no grammatical gender to get wrong.
					person.pending
						? html`<wa-badge variant="neutral">${msg("Pending")}</wa-badge>`
						: nothing
				}
			<wa-dropdown
				@wa-select=${(domEvent: Event) => onAction(person, domEvent)}
			>
				<wa-button
					slot="trigger"
					appearance="plain"
					.withCaret=${true}
					?disabled=${busy}
				>
					<span class="sr-only">
						${msg(str`Access for ${person.name}`)}
					</span>
					${person.role === "editor" ? msg("Editor") : msg("Viewer")}
				</wa-button>

				<wa-dropdown-item
					type="checkbox"
					value="viewer"
					?checked=${person.role === "viewer"}
				>
					${msg("Viewer")}
				</wa-dropdown-item>
				<wa-dropdown-item
					type="checkbox"
					value="editor"
					?checked=${person.role === "editor"}
				>
					${msg("Editor")}
				</wa-dropdown-item>
				<wa-divider></wa-divider>
				<wa-dropdown-item value="remove" variant="danger">
					${person.pending ? msg("Cancel invitation") : msg("Remove access")}
				</wa-dropdown-item>
			</wa-dropdown>
			</span>
		</li>
	`;
}
