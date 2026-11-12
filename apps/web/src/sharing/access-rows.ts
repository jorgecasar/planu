import "@awesome.me/webawesome/dist/components/avatar/avatar.js";
import "@awesome.me/webawesome/dist/components/badge/badge.js";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/divider/divider.js";
import "@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@awesome.me/webawesome/dist/components/dropdown/dropdown.js";
import { msg, str } from "@lit/localize";
import { css, html, nothing } from "lit";
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

/** The rows' rules, for the shadow root they render into. */
export const accessRowStyles = css`
	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--wa-space-s);
		padding-block: var(--wa-space-xs);
	}

	/* The avatar is a flex item too, and without this it is the first thing
	   to give when the row runs out of room: a circle squeezed horizontally
	   turns into an oval and reads as broken. */
	wa-avatar {
		flex: 0 0 auto;
	}

	/* Takes the slack so the trailing control stays put, and the zero minimum
	   size lets it shrink: without that, a long name pushes the control off
	   the edge instead of ellipsing. */
	.identity {
		flex: 1 1 auto;
		min-inline-size: 0;
	}

	.name {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* The theme's quiet text token measures 4.33:1 on this surface, under the
	   4.5:1 AA asks for text this size — axe fails it. The hierarchy here
	   comes from the smaller size instead of from washing out the colour. */
	.detail {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--wa-font-size-s);
		color: var(--wa-color-text-normal);
	}

	/* Keeps every row the same shape: whatever the state, the trailing
	   control sits at the same place and never wraps under the name. */
	.trailing {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: var(--wa-space-xs);
	}

	/* Not a control: the owner's role cannot be changed by anyone. */
	.owner-role {
		color: var(--wa-color-text-normal);
		font-size: var(--wa-font-size-s);
		white-space: nowrap;
	}

	/* Web Awesome's wa-visually-hidden utility is a global class and does not
	   cross into this shadow root, so the screen-reader text was rendering in
	   plain sight. Same technique, declared where it applies. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
`;
