import { expect, type Page, test } from "@playwright/test";
import {
	API_KEY,
	AUTH_EMULATOR,
	createAccount,
	createVerifiedAccount,
	newEmail,
	signIn,
	submitLogin,
} from "./verified-account.js";

const FIRESTORE_EMULATOR =
	"http://127.0.0.1:8181/v1/projects/planu-app/databases/planu/documents";
const STORAGE_EMULATOR = "http://127.0.0.1:9199/v0/b";
const STORAGE_BUCKET = "planu-app.firebasestorage.app";
const ADMIN = { Authorization: "Bearer owner" };

/** PNG de 1x1 píxel, suficiente para ejercitar la subida a Storage. */
const PIXEL_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Título único por ejecución: el emulador conserva los datos entre runs. */
const newTitle = (base: string) =>
	`${base} ${Math.random().toString(36).slice(2, 7)}`;

async function createEvent(page: Page, title: string): Promise<void> {
	await page.getByRole("button", { name: "New event" }).click();
	await page.getByLabel("Title").fill(title);
	await page.getByLabel("Description").fill(`About ${title}`);
	await page.getByLabel("Location").fill("Madrid");
	await page.getByRole("button", { name: "Save event" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	await expect(page.locator("planu-event-editor dialog")).toBeHidden();
}

interface EmulatorDocument {
	name: string;
	fields: Record<string, unknown>;
}

/** Ejecuta una `runQuery` contra Firestore con el token de administración. */
async function queryEvents(
	page: Page,
	filter: Record<string, unknown>,
): Promise<EmulatorDocument[]> {
	const response = await page.request.post(`${FIRESTORE_EMULATOR}:runQuery`, {
		headers: ADMIN,
		data: {
			structuredQuery: { from: [{ collectionId: "events" }], where: filter },
		},
	});
	const rows = (await response.json()) as { document?: EmulatorDocument }[];
	return rows
		.map((row) => row.document)
		.filter((doc): doc is EmulatorDocument => doc !== undefined);
}

function byTitle(title: string) {
	return {
		fieldFilter: {
			field: { fieldPath: "title" },
			op: "EQUAL",
			value: { stringValue: title },
		},
	};
}

function stringField(doc: EmulatorDocument, field: string): string | undefined {
	return (doc.fields[field] as { stringValue?: string } | undefined)
		?.stringValue;
}

function memberIdsOf(doc: EmulatorDocument): string[] {
	const value = doc.fields["memberIds"] as
		| { arrayValue?: { values?: { stringValue: string }[] } }
		| undefined;
	return (value?.arrayValue?.values ?? []).map((entry) => entry.stringValue);
}

/**
 * Sube una imagen a Storage con la cabecera `Authorization` dada —el idToken
 * real de su dueño respeta las reglas de verdad—, y devuelve la URL de
 * descarga con la misma forma que produce el SDK contra el emulador:
 * `http://127.0.0.1:9199/...`, no `https://firebasestorage.googleapis.com/...`.
 */
async function uploadEventImage(
	page: Page,
	uid: string,
	authorization: string,
): Promise<string> {
	const path = `events/${uid}/cartel-${Math.random().toString(36).slice(2, 8)}.png`;
	const response = await page.request.post(
		`${STORAGE_EMULATOR}/${STORAGE_BUCKET}/o?name=${encodeURIComponent(path)}`,
		{
			headers: {
				Authorization: authorization,
				"Content-Type": "image/png",
			},
			data: Buffer.from(PIXEL_BASE64, "base64"),
		},
	);
	expect(response.ok(), await response.text()).toBe(true);
	const { downloadTokens } = (await response.json()) as {
		downloadTokens: string;
	};
	// "localhost", no "127.0.0.1": `connectStorageEmulator` en la app real se
	// conecta con ese host exacto (`firebase-provider.ts`), y `ref(storage,
	// url)` rechaza con `storage/invalid-url` cualquier URL cuyo host no sea
	// una coincidencia textual — comprobado a mano, ambos resuelven a la misma
	// máquina pero el SDK no los trata como equivalentes.
	return `http://localhost:9199/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${downloadTokens}`;
}

/**
 * Crea directamente en Firestore, con el token de administración, un evento
 * propio con imagen ya adjunta.
 *
 * No pasa por el formulario: `firestore.rules` fija `imageUrl` al host de
 * producción de Storage (`firebasestorage.googleapis.com`), y el emulador de
 * Storage —el que este spec usa a propósito, para probar el borrado de
 * verdad— siempre da URLs con su propio host. Guardar esa URL desde el
 * cliente real, contra esas reglas, no puede funcionar hoy; es un límite del
 * entorno de pruebas, no algo que T32 deba resolver. Lo que sí importa aquí
 * —y sí se hace por el camino real— es la parte bajo prueba: el borrado, que
 * corre con la sesión real de su dueño contra Storage y Firestore de verdad.
 */
async function createOwnEventWithImageViaAdmin(
	page: Page,
	{ title, uid, imageUrl }: { title: string; uid: string; imageUrl: string },
): Promise<string> {
	const response = await page.request.post(`${FIRESTORE_EMULATOR}/events`, {
		headers: ADMIN,
		data: {
			fields: {
				title: { stringValue: title },
				description: { stringValue: `About ${title}` },
				location: { stringValue: "Madrid" },
				userId: { stringValue: uid },
				memberIds: { arrayValue: { values: [{ stringValue: uid }] } },
				roles: { mapValue: { fields: {} } },
				imageUrl: { stringValue: imageUrl },
			},
		},
	});
	expect(response.ok(), await response.text()).toBe(true);
	const { name } = (await response.json()) as { name: string };
	return name.split("/").pop() as string;
}

async function readDoc(
	page: Page,
	collection: string,
	docId: string,
): Promise<unknown> {
	const response = await page.request.get(
		`${FIRESTORE_EMULATOR}/${collection}/${docId}`,
		{ headers: ADMIN },
	);
	if (response.status() === 404) return undefined;
	return response.json();
}

async function listEventImages(page: Page, uid: string): Promise<unknown[]> {
	const response = await page.request.get(
		`${STORAGE_EMULATOR}/${STORAGE_BUCKET}/o?prefix=${encodeURIComponent(`events/${uid}/`)}`,
		{ headers: ADMIN },
	);
	const body = (await response.json()) as { items?: unknown[] };
	return body.items ?? [];
}

/** Signs in through the emulator's REST API. */
function signInByApi(page: Page, email: string) {
	return page.request.post(
		`${AUTH_EMULATOR}/accounts:signInWithPassword?key=${API_KEY}`,
		{ data: { email, password: "secret123", returnSecureToken: true } },
	);
}

async function deleteAccountFromProfile(
	page: Page,
	email: string,
): Promise<void> {
	if (!page.url().endsWith("/app/profile")) await page.goto("/app/profile");
	await page.getByRole("button", { name: "Delete account" }).click();
	await page.getByLabel("Email").fill(email);
	// No `getByRole("dialog")`: el botón vive en el slot `footer`, y Web
	// Awesome lo re-proyecta de un modo que el árbol de accesibilidad de
	// Playwright no cuenta como descendiente del rol `dialog` aunque sí lo
	// pinte dentro — comprobado a mano, `getByRole("dialog")` encuentra el
	// elemento pero un `getByRole("button", …)` anidado no encuentra nada
	// dentro de él. El propio elemento `<wa-dialog>` sí lo contiene de verdad.
	await page
		.locator("wa-dialog")
		.getByRole("button", { name: "Delete account" })
		.click();

	// El redirigido a login es la señal de que `deleteAccount()` resolvió de
	// verdad, no sólo que se pulsó el botón.
	await expect(page).toHaveURL(/\/app\/login$/, { timeout: 15_000 });
}

test("borrar la cuenta no deja nada suyo: eventos propios, imágenes, directorio y membresías ajenas — y la cuenta de Auth deja de existir (T32)", async ({
	page,
	browser,
}) => {
	// Bastante más largo que el resto: dos cuentas verificadas por email, una
	// subida real a Storage y un borrado con varios pasos de red. El timeout
	// por defecto (30 s) se agotaba a mitad, antes incluso de llegar al paso
	// bajo prueba.
	test.setTimeout(90_000);

	const ownerEmail = newEmail();
	const deletedEmail = newEmail();
	const ownedTitle = newTitle("Evento propio de B");
	const sharedTitle = newTitle("Evento compartido por A");

	await createVerifiedAccount(page, ownerEmail);
	await createVerifiedAccount(page, deletedEmail);

	// B entra primero, en su propia sesión: entrar es lo que la publica en el
	// directorio, y sólo entonces A puede encontrarla por email para invitarla
	// — mismo orden que exige `sharing.spec.ts`.
	const context = await browser.newContext();
	const guestPage = await context.newPage();
	await signIn(guestPage, deletedEmail);

	// A crea un evento y lo comparte con B.
	await signIn(page, ownerEmail);
	await createEvent(page, sharedTitle);
	await page.getByRole("button", { name: "Share" }).click();
	await page.getByLabel("Invite by email").fill(deletedEmail);
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await expect(page.getByLabel("Invite by email")).toHaveValue("");
	await page.keyboard.press("Escape");

	// B acepta la invitación.
	await guestPage.reload();
	await guestPage.getByRole("button", { name: "Accept" }).click();

	// El evento de A ya tiene a B como miembro: de ahí se leen ambos uids, sin
	// depender de ningún acceso de administración para conocerlos.
	await expect
		.poll(async () => {
			const [shared] = await queryEvents(guestPage, byTitle(sharedTitle));
			return shared ? memberIdsOf(shared).length : 0;
		})
		.toBe(2);
	const [sharedBefore] = await queryEvents(guestPage, byTitle(sharedTitle));
	const ownerUid = stringField(sharedBefore as EmulatorDocument, "userId");
	expect(ownerUid).toBeDefined();
	const guestUid = memberIdsOf(sharedBefore as EmulatorDocument).find(
		(id) => id !== ownerUid,
	);
	expect(guestUid, "B no aparece como miembro del evento de A").toBeDefined();
	const uid = guestUid as string;

	// B sube una portada real a Storage —con su propio idToken, no con el de
	// administración— y con ella se crea su evento propio.
	const { idToken } = (await (
		await signInByApi(guestPage, deletedEmail)
	).json()) as { idToken: string };
	const imageUrl = await uploadEventImage(
		guestPage,
		uid,
		`Firebase ${idToken}`,
	);
	const ownedId = await createOwnEventWithImageViaAdmin(guestPage, {
		title: ownedTitle,
		uid,
		imageUrl,
	});

	// Antes de borrar: la imagen está de verdad en Storage.
	await expect
		.poll(() => listEventImages(guestPage, uid).then((items) => items.length))
		.toBe(1);

	// La invitación recibida (aceptada) ya existe; la enviada se siembra con
	// la forma de `isValidInvite()`, porque el evento propio de B no pasa por
	// la interfaz.
	const sharedId = (sharedBefore as EmulatorDocument).name.split("/").pop();
	const receivedInvite = `${sharedId}_${uid}`;
	const sentInvite = `${ownedId}_${ownerUid}`;
	const seeded = await page.request.patch(
		`${FIRESTORE_EMULATOR}/eventInvites/${sentInvite}`,
		{
			headers: ADMIN,
			data: {
				fields: {
					eventId: { stringValue: ownedId },
					eventTitle: { stringValue: ownedTitle },
					inviteeUid: { stringValue: ownerUid },
					invitedBy: { stringValue: uid },
					role: { stringValue: "viewer" },
					status: { stringValue: "pending" },
					createdAt: { timestampValue: new Date().toISOString() },
					decidedAt: { nullValue: null },
				},
			},
		},
	);
	expect(seeded.ok(), await seeded.text()).toBe(true);
	expect(await readDoc(page, "eventInvites", receivedInvite)).toBeDefined();

	// B borra su cuenta desde la interfaz — el mismo camino que seguiría una
	// persona real, no un atajo por la API de administración.
	await deleteAccountFromProfile(guestPage, deletedEmail);

	// 0) Sus invitaciones, recibidas y enviadas, han desaparecido.
	expect(await readDoc(page, "eventInvites", receivedInvite)).toBeUndefined();
	expect(await readDoc(page, "eventInvites", sentInvite)).toBeUndefined();

	// 1) El evento propio de B ha desaparecido de Firestore.
	await expect
		.poll(async () => (await queryEvents(page, byTitle(ownedTitle))).length)
		.toBe(0);

	// 2) Su imagen de portada ha desaparecido de Storage.
	await expect.poll(() => listEventImages(page, uid)).toEqual([]);

	// 3) El evento de A sigue existiendo, pero sin B entre sus miembros.
	const [sharedAfter] = await queryEvents(page, byTitle(sharedTitle));
	expect(sharedAfter, "el evento de A desapareció, y no debía").toBeDefined();
	expect(memberIdsOf(sharedAfter as EmulatorDocument)).not.toContain(uid);

	// 4) Su entrada de perfil ha desaparecido.
	expect(await readDoc(page, "userProfiles", uid)).toBeUndefined();

	// 5) La cuenta de Auth ya no existe: intentar entrar con sus credenciales
	// falla, el mismo camino que seguiría una persona real. Con `guestPage`,
	// no con `page`: `page` sigue siendo la sesión de A, todavía autenticada,
	// y un `goto("/app/login")` con sesión activa rebota a la vista de
	// eventos en vez de mostrar el formulario.
	await guestPage.goto("/app/login");
	const panel = guestPage
		.getByRole("tabpanel")
		.filter({ hasText: "Password" })
		.first();
	await panel.getByLabel("Email").fill(deletedEmail);
	await panel.getByLabel("Password", { exact: true }).fill("secret123");
	await panel.getByRole("button", { name: "Sign in" }).click();
	await expect(guestPage.getByRole("alert")).toBeVisible();
	await expect(
		guestPage.getByRole("button", { name: "New event" }),
	).not.toBeVisible();

	await context.close();
});

test("una cuenta sin verificar también puede borrarse: imágenes, perfil y cuenta de Auth desaparecen", async ({
	page,
}) => {
	const email = newEmail();
	const { uid } = await createAccount(page, email);
	expect((await signInByApi(page, email)).ok()).toBe(true);

	// The rules deny an unverified account both writes, so the orphan image
	// and the `userProfiles` entry are seeded as admin.
	await uploadEventImage(page, uid, ADMIN.Authorization);
	expect(await listEventImages(page, uid)).toHaveLength(1);
	const profile = await page.request.patch(
		`${FIRESTORE_EMULATOR}/userProfiles/${uid}`,
		{
			headers: ADMIN,
			data: {
				fields: {
					displayName: { stringValue: "Ana" },
					photoURL: { stringValue: "" },
				},
			},
		},
	);
	expect(profile.ok(), await profile.text()).toBe(true);

	await submitLogin(page, email);
	await expect(page).toHaveURL(/\/app\/profile$/);
	await deleteAccountFromProfile(page, email);

	expect((await signInByApi(page, email)).ok()).toBe(false);
	expect(await listEventImages(page, uid)).toEqual([]);
	expect(await readDoc(page, "userProfiles", uid)).toBeUndefined();
});
