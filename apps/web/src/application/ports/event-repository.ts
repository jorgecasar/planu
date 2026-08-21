import type { PlanuEvent } from "../../lib/types.js";

/**
 * Lo que hace falta para guardar un evento desde el editor. Firebase es un
 * detalle de `infrastructure/`: `event-editor.ts` no debe conocer
 * `Timestamp`, `doc`, `setDoc` ni `addDoc`.
 *
 * Acotado a lo que el editor necesita hoy —crear y editar—, no un espejo de
 * `firebase/firestore`. Ampliar esta forma es legítimo el día que otro caso
 * de uso lo necesite; no antes.
 */
export interface EventRepositoryPort {
	/**
	 * Crea un evento nuevo con su creador como único miembro. Devuelve el
	 * identificador asignado.
	 */
	create(values: PlanuEvent, ownerUid: string): Promise<string>;

	/**
	 * Actualiza el contenido de un evento existente.
	 *
	 * Sólo el contenido: no toca `userId`, `memberIds` ni `roles`. Reenviar el
	 * uid de quien edita costaría su permiso a un editor invitado —para las
	 * reglas equivale a transferirse la propiedad— y la pertenencia es cosa
	 * del diálogo de compartir, no de este puerto.
	 */
	update(id: string, values: PlanuEvent): Promise<void>;
}
