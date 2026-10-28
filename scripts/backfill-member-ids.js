/**
 * Backfill de `memberIds` y `roles` en los eventos de la fase 1.
 *
 * Los eventos creados antes de la compartición (T13/T14) tienen `userId` pero
 * no `memberIds`, y `firestore.rules` lee la membresía de ese campo: sin él,
 * **ni su dueño puede leerlos**. Este script les pone `memberIds: [userId]` y
 * `roles: {}`, que es exactamente lo que el editor escribe hoy al crear.
 *
 * ```bash
 * # simulación (por defecto): lista lo que haría, no escribe nada
 * node scripts/backfill-member-ids.js
 *
 * # escribir de verdad
 * node scripts/backfill-member-ids.js --apply
 *
 * # contra los emuladores
 * FIRESTORE_EMULATOR_HOST=localhost:8181 node scripts/backfill-member-ids.js
 * ```
 *
 * Usa `firebase-admin` con las credenciales por defecto de la aplicación
 * (`gcloud auth application-default login`), así que se salta las reglas: por
 * eso simula salvo que se pida `--apply`. Ver
 * `docs/runbook-backfill-member-ids.md` antes de ejecutarlo contra producción.
 *
 * Sólo toca lo que puede arreglar sin decidir nada:
 *
 * - Sin `memberIds` y con `userId` → se completa.
 * - Sin `userId` → se informa y no se toca. Es dato anterior a esta
 *   reescritura (pregunta abierta nº 1 de `SPEC.md`): migrarlo o borrarlo es
 *   decisión de una persona.
 * - Sin `memberIds` pero con `roles` no vacío → se informa y no se toca: no
 *   hay forma de saber qué miembros implicaban esos roles.
 *
 * Cada escritura lleva como precondición el `updateTime` leído, así que si el
 * documento cambió entre la lectura y la escritura, falla en vez de pisarlo.
 */

import { pathToFileURL } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROYECTO = "planu-app";
const BASE_DE_DATOS = "planu";
const COLECCION = "events";
const PAGINA = 300;

/**
 * Decide qué hacer con un evento a partir de sus datos. Pura, para poder
 * razonar sobre ella sin Firestore delante.
 *
 * @param {Record<string, unknown>} d
 * @returns {{ accion: "ok" } | { accion: "completar", cambios: Record<string, unknown> } | { accion: "revisar", motivo: string }}
 */
export function planificar(d) {
	if (Array.isArray(d.memberIds)) return { accion: "ok" };
	if (typeof d.userId !== "string" || d.userId === "") {
		return { accion: "revisar", motivo: "sin userId" };
	}
	const roles = d.roles;
	const sinRoles =
		roles === undefined ||
		(typeof roles === "object" &&
			roles !== null &&
			Object.keys(roles).length === 0);
	if (!sinRoles) {
		return { accion: "revisar", motivo: "roles sin memberIds" };
	}
	return { accion: "completar", cambios: { memberIds: [d.userId], roles: {} } };
}

async function main() {
	const aplicar = process.argv.includes("--apply");
	const db = getFirestore(
		initializeApp({ projectId: PROYECTO }),
		BASE_DE_DATOS,
	);
	const destino = process.env["FIRESTORE_EMULATOR_HOST"]
		? `emulador ${process.env["FIRESTORE_EMULATOR_HOST"]}`
		: `PRODUCCIÓN (${PROYECTO}/${BASE_DE_DATOS})`;
	console.log(
		`${aplicar ? "ESCRIBIENDO en" : "Simulación contra"} ${destino}\n`,
	);

	const cuenta = { ok: 0, completar: 0, revisar: 0, escritos: 0 };
	let ultimo;
	for (;;) {
		let consulta = db.collection(COLECCION).orderBy("__name__").limit(PAGINA);
		if (ultimo) consulta = consulta.startAfter(ultimo);
		const pagina = await consulta.get();
		if (pagina.empty) break;

		const lote = db.batch();
		let enLote = 0;
		for (const doc of pagina.docs) {
			const plan = planificar(doc.data());
			cuenta[plan.accion]++;
			if (plan.accion === "revisar") {
				console.log(`revisar   ${doc.id}  (${plan.motivo})`);
			} else if (plan.accion === "completar") {
				console.log(
					`completar ${doc.id}  memberIds=[${plan.cambios.memberIds}]`,
				);
				if (aplicar) {
					lote.update(doc.ref, plan.cambios, {
						lastUpdateTime: doc.updateTime,
					});
					enLote++;
				}
			}
		}
		if (enLote > 0) {
			await lote.commit();
			cuenta.escritos += enLote;
		}
		ultimo = pagina.docs[pagina.docs.length - 1];
	}

	console.log(
		`\nok: ${cuenta.ok}  completar: ${cuenta.completar}  revisar: ${cuenta.revisar}  escritos: ${cuenta.escritos}`,
	);
	if (!aplicar && cuenta.completar > 0) {
		console.log("Nada escrito. Repite con --apply para aplicar los cambios.");
	}
	if (cuenta.revisar > 0) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
