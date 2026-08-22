import type { PlanuEvent } from "../../lib/types.js";

/** What `create()` resolves with. */
export interface CreatedEvent {
	id: string;
	/**
	 * Whether the owner had zero visible events right before this write.
	 * T31's `trackFirstEventCreated()` needs it, and the count it depends
	 * on — `getCountFromServer` against the same `memberIds` query the
	 * listing uses — is a Firestore detail: the editor shouldn't have to
	 * know how "first event" gets decided, only whether it happened.
	 */
	wasFirstEvent: boolean;
}

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
	 * Crea un evento nuevo con su creador como único miembro.
	 */
	create(values: PlanuEvent, ownerUid: string): Promise<CreatedEvent>;

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
