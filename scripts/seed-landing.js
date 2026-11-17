/**
 * Seeds the emulators with the account and events the landing screenshots show
 * (#271, R4): invented titles and places, synthetic covers from
 * `landing-covers.js`, no real person or data (decision D14).
 *
 * ```bash
 * npm run emulators        # in another terminal
 * npm run seed:landing     # or: npm run seed:landing -- other@example.com
 * ```
 * Writes as the user, through `firestore.rules`, like `seed-emulator.js`, and
 * dates are relative to today so the list always shows what is coming.
 */
import { COVER_NAMES, coverUrl } from "./landing-covers.js";
import { openVerifiedSession } from "./seed-session.js";

const FIRESTORE =
	"http://localhost:8181/v1/projects/planu-app/databases/planu/documents";
const EMAIL = process.argv[2] ?? "landing.demo@example.com";
const PASSWORD = "secret123";

/** [title, location, days from today, hour, cover, tags, description] */
const EVENTS = [
	[
		"Sunday picnic",
		"Parque del Oeste",
		3,
		12,
		"picnic",
		["family"],
		"Blankets, lemonade and a long afternoon.",
	],
	[
		"Jazz in the courtyard",
		"Patio de la Villa",
		6,
		21,
		"concert",
		["music"],
		"A quartet under the lights. Doors at nine.",
	],
	[
		"Weekend in the mountains",
		"Sierra Norte",
		12,
		9,
		"trip",
		["trip"],
		"Two days of walking and one big dinner.",
	],
	[
		"Dinner with the neighbours",
		"Casa de Marta",
		16,
		20,
		"dinner",
		["family"],
		"Everyone brings a dish to share.",
	],
	[
		"Neighbourhood five-a-side",
		"Polideportivo",
		21,
		18,
		"match",
		["sport"],
		"Teams are drawn at the door.",
	],
	[
		"Flea market",
		"Plaza Mayor",
		27,
		10,
		"market",
		["weekend"],
		"Come early for the best stalls.",
	],
];

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

if (EVENTS.some(([, , , , cover]) => !COVER_NAMES.includes(cover))) {
	throw new Error("an event names a cover that does not exist");
}

const { idToken, localId: uid } = await openVerifiedSession({
	email: EMAIL,
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

for (const [title, location, days, hour, cover, tags, description] of EVENTS) {
	await json(`${FIRESTORE}/events`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			fields: {
				title: text(title),
				description: text(description),
				location: text(location),
				imageUrl: text(coverUrl(cover)),
				userId: text(uid),
				memberIds: { arrayValue: { values: [text(uid)] } },
				roles: { mapValue: { fields: {} } },
				tags: { arrayValue: { values: tags.map(text) } },
				allDay: { booleanValue: false },
				startDate: { timestampValue: at(days, hour) },
				endDate: { timestampValue: at(days, hour + 2) },
				createdAt: { timestampValue: new Date().toISOString() },
			},
		}),
	});
}
console.log(
	`${EVENTS.length} events for ${EMAIL}, covers from landing-covers.js`,
);
