/**
 * Siembra los emuladores con una cuenta y unos eventos con los que probar la
 * aplicación a mano.
 *
 * ```bash
 * npm run emulators          # en otra terminal
 * npm run seed               # o: npm run seed -- otra@example.com
 * ```
 *
 * Escribe **como el usuario**, no saltándose las reglas con el acceso de
 * administración: si algo no pasa la validación de `firestore.rules`, es mejor
 * enterarse aquí que en la interfaz.
 *
 * Las fechas son **relativas a hoy**, no fijas. La vista separa próximos de
 * pasados por el instante actual, así que un dato fijo cambiaría de grupo con
 * el paso del tiempo y la siembra dejaría de enseñar lo que viene a enseñar.
 *
 * El conjunto está elegido para que se vea cada cosa: eventos en los tres
 * grupos, alguno que cruza varios días, alguno sin fecha, etiquetas repetidas
 * entre eventos para que el filtro con **Y** tenga sentido, y títulos cuyo
 * orden alfabético **no** coincide con el cronológico —si coincidiera, cambiar
 * de orden no se notaría—.
 */

const PROYECTO = "planu-app";
const BASE_DE_DATOS = "planu";
const AUTH = "http://localhost:9099/identitytoolkit.googleapis.com/v1";
const FIRESTORE = `http://localhost:8181/v1/projects/${PROYECTO}/databases/${BASE_DE_DATOS}/documents`;

const EMAIL = process.argv[2] ?? "algae.algae.96@example.com";
const CLAVE = "secret123";

const HOY = new Date();
const dia = (offset, hora = 10) => {
	const d = new Date(HOY);
	d.setDate(d.getDate() + offset);
	d.setHours(hora, 0, 0, 0);
	return d.toISOString();
};
const creado = (offset) => {
	const d = new Date(HOY);
	d.setDate(d.getDate() + offset);
	return d.toISOString();
};

// [título, ubicación, offsetInicio, offsetFin, etiquetas, offsetCreación]
// Títulos elegidos a propósito para que el orden alfabético **no** coincida con
// el cronológico: si coincidieran, cambiar de orden no se notaría.
const EVENTOS = [
	["Zumba en el parque", "Retiro", 2, 2, ["deporte"], -1],
	["Almuerzo con Ana", "Casa Lucio", 5, 5, ["cena"], -20],
	["Mudanza", "Casa nueva", 9, 11, ["casa"], -3],
	["Boda de Marta", "Segovia", 21, 22, ["viaje"], -60],
	["Curso de cerámica", "La Nave", 40, 44, ["taller"], -8],

	["Feria de abril", "Sevilla", -120, -114, ["feria", "viaje"], -200],
	["Concierto de verano", "Auditorio", -30, -30, ["música"], -45],
	["Revisión del coche", "Taller Ruiz", -12, -12, ["casa"], -14],
	["Antigua reunión", "Oficina", -3, -3, ["trabajo"], -5],

	[
		"Escapada rural, algún fin de semana",
		"",
		null,
		null,
		["idea", "viaje"],
		-2,
	],
	["Idea de regalo para Marta", "", null, null, ["idea"], -30],
];

async function json(url, opciones) {
	const respuesta = await fetch(url, opciones);
	const cuerpo = await respuesta.json().catch(() => ({}));
	if (!respuesta.ok) {
		throw new Error(
			`${respuesta.status} ${url}\n${JSON.stringify(cuerpo, null, 2)}`,
		);
	}
	return cuerpo;
}

async function sesion() {
	const cuerpo = JSON.stringify({
		email: EMAIL,
		password: CLAVE,
		returnSecureToken: true,
	});
	const cabeceras = { "Content-Type": "application/json" };
	try {
		const alta = await json(`${AUTH}/accounts:signUp?key=fake-api-key`, {
			method: "POST",
			headers: cabeceras,
			body: cuerpo,
		});
		console.log(`usuario creado: ${EMAIL}`);
		return alta;
	} catch (error) {
		if (!String(error).includes("EMAIL_EXISTS")) throw error;
		return json(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, {
			method: "POST",
			headers: cabeceras,
			body: cuerpo,
		});
	}
}

const { idToken, localId: uid } = await sesion();
const auth = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${idToken}`,
};

const existentes = await json(`${FIRESTORE}:runQuery`, {
	method: "POST",
	headers: auth,
	body: JSON.stringify({
		structuredQuery: {
			from: [{ collectionId: "events" }],
			where: {
				fieldFilter: {
					field: { fieldPath: "memberIds" },
					op: "ARRAY_CONTAINS",
					value: { stringValue: uid },
				},
			},
		},
	}),
});
const previos = existentes.filter((fila) => fila.document);
for (const fila of previos) {
	await fetch(`http://localhost:8181/v1/${fila.document.name}`, {
		method: "DELETE",
		headers: auth,
	});
}
console.log(`borrados ${previos.length} eventos previos`);

let n = 0;
for (const [title, location, ini, fin, tags, hecho] of EVENTOS) {
	await json(`${FIRESTORE}/events`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({
			fields: {
				title: { stringValue: title },
				description: {
					stringValue: "Sembrado para probar el orden y la agrupación.",
				},
				location: { stringValue: location },
				imageUrl: { stringValue: "" },
				userId: { stringValue: uid },
				memberIds: { arrayValue: { values: [{ stringValue: uid }] } },
				roles: { mapValue: { fields: {} } },
				tags: { arrayValue: { values: tags.map((t) => ({ stringValue: t })) } },
				startDate:
					ini === null ? { nullValue: null } : { timestampValue: dia(ini) },
				endDate:
					fin === null ? { nullValue: null } : { timestampValue: dia(fin, 20) },
				createdAt: { timestampValue: creado(hecho) },
			},
		}),
	});
	n += 1;
}

const futuros = EVENTOS.filter(([, , i]) => i !== null && i > 0).length;
const pasados = EVENTOS.filter(([, , i]) => i !== null && i < 0).length;
const sinFecha = EVENTOS.filter(([, , i]) => i === null).length;
console.log(
	`\n${n} eventos: ${futuros} próximos, ${sinFecha} sin fecha, ${pasados} pasados`,
);
console.log(`entra con ${EMAIL} / ${CLAVE}`);
