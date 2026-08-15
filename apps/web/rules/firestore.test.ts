import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	query,
	setDoc,
	Timestamp,
	where,
} from "firebase/firestore";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

const VICTIMA = "victima-uid";
const ATACANTE = "atacante-uid";

let env: RulesTestEnvironment;

const evento = (userId: string, extra: Record<string, unknown> = {}) => ({
	title: "Concierto de verano",
	description: "Música en directo",
	location: "Madrid",
	userId,
	startDate: null,
	endDate: null,
	imageUrl: "",
	...extra,
});

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-rules-test",
		firestore: {
			host: "localhost",
			port: 8181,
			rules: readFileSync("../../firestore.rules", "utf8"),
		},
	});
});

afterAll(async () => {
	await env?.cleanup();
});

beforeEach(async () => {
	await env.clearFirestore();
	// Un evento de la víctima, escrito saltándose las reglas.
	await env.withSecurityRulesDisabled(async (ctx) => {
		await setDoc(
			doc(ctx.firestore(), "events/evento-victima"),
			evento(VICTIMA),
		);
	});
});

const comoAtacante = () => env.authenticatedContext(ATACANTE).firestore();
const comoVictima = () => env.authenticatedContext(VICTIMA).firestore();
const sinSesion = () => env.unauthenticatedContext().firestore();

describe("privacidad entre usuarios", () => {
	test("el dueño lee su propio evento", async () => {
		await assertSucceeds(getDoc(doc(comoVictima(), "events/evento-victima")));
	});

	test("otro usuario no puede leer un evento ajeno por id", async () => {
		await assertFails(getDoc(doc(comoAtacante(), "events/evento-victima")));
	});

	test("otro usuario no puede listar los eventos de la víctima", async () => {
		await assertFails(
			getDocs(
				query(
					collection(comoAtacante(), "events"),
					where("userId", "==", VICTIMA),
				),
			),
		);
	});

	test("nadie puede listar la colección entera sin filtrar", async () => {
		await assertFails(getDocs(collection(comoAtacante(), "events")));
	});

	test("sin sesión no se lee nada", async () => {
		// Esta es la fuga que traía el prototipo: allow read: if true.
		await assertFails(getDoc(doc(sinSesion(), "events/evento-victima")));
		await assertFails(getDocs(collection(sinSesion(), "events")));
	});
});

describe("propiedad", () => {
	test("no se puede crear un evento en nombre de otro", async () => {
		await assertFails(
			addDoc(collection(comoAtacante(), "events"), evento(VICTIMA)),
		);
	});

	test("no se puede modificar el evento de otro", async () => {
		await assertFails(
			setDoc(
				doc(comoAtacante(), "events/evento-victima"),
				evento(VICTIMA, { title: "Secuestrado" }),
			),
		);
	});

	test("no se puede robar la propiedad en un update", async () => {
		await assertFails(
			setDoc(doc(comoAtacante(), "events/evento-victima"), evento(ATACANTE)),
		);
	});

	test("no se puede borrar el evento de otro", async () => {
		await assertFails(deleteDoc(doc(comoAtacante(), "events/evento-victima")));
	});

	test("el dueño sí puede modificar y borrar el suyo", async () => {
		await assertSucceeds(
			setDoc(
				doc(comoVictima(), "events/evento-victima"),
				evento(VICTIMA, { title: "Título nuevo" }),
			),
		);
		await assertSucceeds(
			deleteDoc(doc(comoVictima(), "events/evento-victima")),
		);
	});

	test("sin sesión no se puede crear", async () => {
		await assertFails(
			addDoc(collection(sinSesion(), "events"), evento(ATACANTE)),
		);
	});
});

describe("forma y tamaño del documento", () => {
	test("un alta válida del propio usuario se acepta", async () => {
		await assertSucceeds(
			addDoc(collection(comoAtacante(), "events"), evento(ATACANTE)),
		);
	});

	test("acepta fechas como Timestamp", async () => {
		await assertSucceeds(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, {
					startDate: Timestamp.fromDate(new Date("2026-06-01")),
					endDate: Timestamp.fromDate(new Date("2026-06-15")),
				}),
			),
		);
	});

	test("rechaza campos de relleno: es el vector de coste", async () => {
		// El auditor coló un documento de 900 KB con las reglas anteriores.
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { junk: "x".repeat(900 * 1024) }),
			),
		);
	});

	test("rechaza un campo desconocido aunque sea diminuto", async () => {
		await assertFails(
			addDoc(collection(comoAtacante(), "events"), evento(ATACANTE, { a: 1 })),
		);
	});

	test("rechaza tipos que romperían el listado en el cliente", async () => {
		// Un description numérico hacía estallar `.toLowerCase()` en render().
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { description: 123 }),
			),
		);
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { location: { anidado: true } }),
			),
		);
	});

	test("rechaza textos desmesurados campo a campo", async () => {
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { description: "x".repeat(5001) }),
			),
		);
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { title: "x".repeat(201) }),
			),
		);
	});

	test("rechaza un título más corto que el mínimo del cliente", async () => {
		await assertFails(
			addDoc(
				collection(comoAtacante(), "events"),
				evento(ATACANTE, { title: "ab" }),
			),
		);
	});

	test("rechaza un alta a la que le faltan campos obligatorios", async () => {
		await assertFails(
			addDoc(collection(comoAtacante(), "events"), {
				title: "Sólo título",
				userId: ATACANTE,
			}),
		);
	});
});
