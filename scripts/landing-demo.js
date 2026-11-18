/**
 * What the landing screenshots show (#271, R4): one demo account per language,
 * each with the same six invented events written in that language, so a
 * Spanish capture does not mix a Spanish interface with English cards.
 * Titles, places and descriptions are made up (decision D14).
 */
export const LANGUAGES = ["en", "es"];

/** One account per language: the emulator keeps them between runs. */
export const emailOf = (lang) => `landing.demo.${lang}@example.com`;
/** The person the share dialog shows as already invited (invented). */
export const guestEmailOf = (lang) => `marta.guest.${lang}@example.com`;
export const PASSWORD = "secret123";

/** days from today, hour, cover (see `landing-covers.js`), then the text per language. */
export const EVENTS = [
	{
		days: 3,
		hour: 12,
		cover: "picnic",
		en: {
			title: "Sunday picnic",
			location: "West Park",
			description: "Blankets, lemonade and a long afternoon.",
			tags: ["family"],
		},
		es: {
			title: "Picnic del domingo",
			location: "Parque del Oeste",
			description: "Mantas, limonada y una tarde larga.",
			tags: ["familia"],
		},
	},
	{
		days: 6,
		hour: 21,
		cover: "concert",
		en: {
			title: "Jazz in the courtyard",
			location: "The old courtyard",
			description: "A quartet under the lights. Doors at nine.",
			tags: ["music"],
		},
		es: {
			title: "Jazz en el patio",
			location: "El patio viejo",
			description: "Un cuarteto bajo las luces. Puertas a las nueve.",
			tags: ["música"],
		},
	},
	{
		days: 12,
		hour: 9,
		cover: "trip",
		en: {
			title: "Weekend in the mountains",
			location: "Northern range",
			description: "Two days of walking and one big dinner.",
			tags: ["trip"],
		},
		es: {
			title: "Fin de semana en la sierra",
			location: "Sierra Norte",
			description: "Dos días de caminata y una cena grande.",
			tags: ["viaje"],
		},
	},
	{
		days: 16,
		hour: 20,
		cover: "dinner",
		en: {
			title: "Dinner with the neighbours",
			location: "Marta's place",
			description: "Everyone brings a dish to share.",
			tags: ["family"],
		},
		es: {
			title: "Cena con los vecinos",
			location: "Casa de Marta",
			description: "Cada uno trae un plato para compartir.",
			tags: ["familia"],
		},
	},
	{
		days: 21,
		hour: 18,
		cover: "match",
		en: {
			title: "Neighbourhood five-a-side",
			location: "Sports centre",
			description: "Teams are drawn at the door.",
			tags: ["sport"],
		},
		es: {
			title: "Fútbol sala del barrio",
			location: "Polideportivo",
			description: "Los equipos se sortean en la puerta.",
			tags: ["deporte"],
		},
	},
	{
		days: 27,
		hour: 10,
		cover: "market",
		en: {
			title: "Flea market",
			location: "Main square",
			description: "Come early for the best stalls.",
			tags: ["weekend"],
		},
		es: {
			title: "Mercadillo",
			location: "Plaza Mayor",
			description: "Ven pronto para pillar los mejores puestos.",
			tags: ["finde"],
		},
	},
];
