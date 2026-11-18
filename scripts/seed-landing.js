/**
 * Seeds the emulators with the accounts and events the landing screenshots show
 * (#271, R4): one demo account per language, invented text from
 * `landing-demo.js`, synthetic covers from `landing-covers.js`, no real person
 * or data (decision D14).
 *
 * ```bash
 * npm run emulators        # in another terminal
 * npm run seed:landing
 * ```
 * Writes as the user, through `firestore.rules`, like `seed-emulator.js`, and
 * dates are relative to today so the list always shows what is coming.
 */
import { COVER_NAMES, coverUrl } from "./landing-covers.js";
import { EVENTS, emailOf, LANGUAGES, PASSWORD } from "./landing-demo.js";
import { openVerifiedSession } from "./seed-session.js";

const FIRESTORE =
	"http://localhost:8181/v1/projects/planu-app/databases/planu/documents";

const at = (days, hour) => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, 0, 0, 0);
	return d.toISOString();
};
const text = (stringValue) => ({ stringValue });

async function json(url, options) {
	const response = await fetch(url, options);
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(`${response.status} ${url}\n${JSON.stringify(body)}`);
	}
	return body;
}

if (EVENTS.some(({ cover }) => !COVER_NAMES.includes(cover))) {
	throw new Error("an event names a cover that does not exist");
}

/** Replaces the events of one language's account with the demo ones. */
async function seed(lang) {
	const email = emailOf(lang);
	const { idToken, localId: uid } = await openVerifiedSession({
		email,
		password: PASSWORD,
	});
	const headers = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${idToken}`,
	};
	const previous = await json(`${FIRESTORE}:runQuery`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			structuredQuery: {
				from: [{ collectionId: "events" }],
				where: {
					fieldFilter: {
						field: { fieldPath: "memberIds" },
						op: "ARRAY_CONTAINS",
						value: text(uid),
					},
				},
			},
		}),
	});
	for (const row of previous.filter((r) => r.document)) {
		await fetch(`http://localhost:8181/v1/${row.document.name}`, {
			method: "DELETE",
			headers,
		});
	}
	for (const event of EVENTS) {
		const { title, location, description, tags } = event[lang];
		await json(`${FIRESTORE}/events`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				fields: {
					title: text(title),
					description: text(description),
					location: text(location),
					imageUrl: text(coverUrl(event.cover)),
					userId: text(uid),
					memberIds: { arrayValue: { values: [text(uid)] } },
					roles: { mapValue: { fields: {} } },
					tags: { arrayValue: { values: tags.map(text) } },
					allDay: { booleanValue: false },
					startDate: { timestampValue: at(event.days, event.hour) },
					endDate: { timestampValue: at(event.days, event.hour + 2) },
					createdAt: { timestampValue: new Date().toISOString() },
				},
			}),
		});
	}
	console.log(`${EVENTS.length} events for ${email}`);
}

for (const lang of LANGUAGES) await seed(lang);
