import { readFileSync } from "node:fs";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	deleteObject,
	getBytes,
	listAll,
	ref,
	uploadBytes,
} from "firebase/storage";
import { afterAll, beforeAll, describe, test } from "vitest";

const VICTIMA = "victima-uid";
const ATACANTE = "atacante-uid";

let env: RulesTestEnvironment;

const imagen = (bytes = 16) => new Uint8Array(bytes).fill(1);
const comoPng = { contentType: "image/png" };

beforeAll(async () => {
	env = await initializeTestEnvironment({
		projectId: "planu-storage-test",
		storage: {
			host: "localhost",
			port: 9199,
			rules: readFileSync("../../storage.rules", "utf8"),
		},
	});
});

afterAll(async () => {
	await env?.cleanup();
});

const verificado = { email_verified: true };
const comoAtacante = () =>
	env.authenticatedContext(ATACANTE, verificado).storage();
const comoVictima = () =>
	env.authenticatedContext(VICTIMA, verificado).storage();
const comoVictimaSinVerificar = () =>
	env.authenticatedContext(VICTIMA, { email_verified: false }).storage();
const sinSesion = () => env.unauthenticatedContext().storage();

describe("propiedad de las imágenes", () => {
	test("el dueño sube a su propia carpeta", async () => {
		await assertSucceeds(
			uploadBytes(
				ref(comoVictima(), `events/${VICTIMA}/cartel.png`),
				imagen(),
				comoPng,
			),
		);
	});

	test("no se puede escribir en la carpeta de otro", async () => {
		// El prototipo permitía justo esto: la ruta no llevaba el uid.
		await assertFails(
			uploadBytes(
				ref(comoAtacante(), `events/${VICTIMA}/suplantada.png`),
				imagen(),
				comoPng,
			),
		);
	});

	test("no se puede leer la imagen de otro", async () => {
		await env.withSecurityRulesDisabled(async (ctx) => {
			await uploadBytes(
				ref(ctx.storage(), `events/${VICTIMA}/privada.png`),
				imagen(),
				comoPng,
			);
		});

		await assertFails(
			getBytes(ref(comoAtacante(), `events/${VICTIMA}/privada.png`)),
		);
	});

	test("sin sesión no se escribe ni se lee", async () => {
		await assertFails(
			uploadBytes(
				ref(sinSesion(), `events/${VICTIMA}/anonima.png`),
				imagen(),
				comoPng,
			),
		);
		await assertFails(
			getBytes(ref(sinSesion(), `events/${VICTIMA}/privada.png`)),
		);
	});

	test("no se puede escribir fuera del prefijo events/", async () => {
		await assertFails(
			uploadBytes(ref(comoAtacante(), "suelto.png"), imagen(), comoPng),
		);
		await assertFails(
			uploadBytes(
				ref(comoAtacante(), `otracosa/${ATACANTE}/x.png`),
				imagen(),
				comoPng,
			),
		);
	});
});

describe("forma del fichero", () => {
	test("rechaza lo que no se declara como imagen", async () => {
		await assertFails(
			uploadBytes(ref(comoVictima(), `events/${VICTIMA}/script.js`), imagen(), {
				contentType: "application/javascript",
			}),
		);
	});

	test("rechaza SVG aunque se declare como imagen", async () => {
		await assertFails(
			uploadBytes(
				ref(comoVictima(), `events/${VICTIMA}/cartel.svg`),
				imagen(),
				{
					contentType: "image/svg+xml",
				},
			),
		);
	});

	test.each([
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif",
		"image/avif",
	])("acepta %s", async (contentType) => {
		await assertSucceeds(
			uploadBytes(ref(comoVictima(), `events/${VICTIMA}/cartel`), imagen(), {
				contentType,
			}),
		);
	});

	test("rechaza ficheros de 5 MB o más", async () => {
		await assertFails(
			uploadBytes(
				ref(comoVictima(), `events/${VICTIMA}/enorme.png`),
				imagen(5 * 1024 * 1024),
				comoPng,
			),
		);
	});

	test("acepta justo por debajo del tope", async () => {
		await assertSucceeds(
			uploadBytes(
				ref(comoVictima(), `events/${VICTIMA}/grande.png`),
				imagen(5 * 1024 * 1024 - 1024),
				comoPng,
			),
		);
	});
});

// Account deletion sweeps the whole `events/{uid}/` folder rather than only
// the images still referenced by an event: an upload whose event was never
// saved would otherwise outlive the account. The sweep relies on these three.
describe("barrido de la carpeta al borrar la cuenta", () => {
	const seed = () =>
		env.withSecurityRulesDisabled(async (ctx) => {
			await uploadBytes(
				ref(ctx.storage(), `events/${VICTIMA}/huerfana.png`),
				imagen(),
				comoPng,
			);
		});

	test("el dueño lista su propia carpeta", async () => {
		await seed();
		await assertSucceeds(listAll(ref(comoVictima(), `events/${VICTIMA}`)));
	});

	test("nadie más lista la carpeta de otro", async () => {
		await seed();
		await assertFails(listAll(ref(comoAtacante(), `events/${VICTIMA}`)));
		await assertFails(listAll(ref(sinSesion(), `events/${VICTIMA}`)));
	});

	test("el dueño borra lo que hay en su carpeta; otro no", async () => {
		await seed();
		await assertFails(
			deleteObject(ref(comoAtacante(), `events/${VICTIMA}/huerfana.png`)),
		);
		await assertSucceeds(
			deleteObject(ref(comoVictima(), `events/${VICTIMA}/huerfana.png`)),
		);
	});

	test("sin verificar, el dueño aún lista y borra su carpeta", async () => {
		await seed();
		await assertSucceeds(
			listAll(ref(comoVictimaSinVerificar(), `events/${VICTIMA}`)),
		);
		await assertSucceeds(
			deleteObject(
				ref(comoVictimaSinVerificar(), `events/${VICTIMA}/huerfana.png`),
			),
		);
	});
});

describe("email verificado para subir", () => {
	test("sin verificar, el dueño no sube a su carpeta", async () => {
		await assertFails(
			uploadBytes(
				ref(comoVictimaSinVerificar(), `events/${VICTIMA}/gratis.png`),
				imagen(),
				comoPng,
			),
		);
	});

	test("sin el claim, tampoco", async () => {
		await assertFails(
			uploadBytes(
				ref(
					env.authenticatedContext(VICTIMA).storage(),
					`events/${VICTIMA}/gratis.png`,
				),
				imagen(),
				comoPng,
			),
		);
	});

	test("verificado, el dueño sí sube", async () => {
		await assertSucceeds(
			uploadBytes(
				ref(comoVictima(), `events/${VICTIMA}/cartel.png`),
				imagen(),
				comoPng,
			),
		);
	});
});
