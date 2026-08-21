import { createContext } from "@lit/context";
import type { FirebaseApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import type { EventRepositoryPort } from "../application/ports/event-repository.js";
import type { ImageStorePort } from "../application/ports/image-store.js";
import type { SessionPort, SessionUser } from "../application/ports/session.js";

/** La app en sí; la necesita Firebase AI Logic, que no cuelga de Firestore. */
export const appContext = createContext<FirebaseApp | undefined>(
	Symbol("planu-app-instance"),
);

/**
 * El puerto de sesión, no `Auth`: quien consume este contexto no sabe que
 * Firebase existe. Ver `application/ports/session.ts`.
 */
export const sessionContext = createContext<SessionPort | undefined>(
	Symbol("planu-session"),
);

export const firestoreContext = createContext<Firestore | undefined>(
	Symbol("planu-firestore"),
);

export const storageContext = createContext<FirebaseStorage | undefined>(
	Symbol("planu-storage"),
);

/**
 * El puerto de repositorio de eventos, no `Firestore`: es lo que permite a
 * `event-editor.ts` dejar de importar `firebase/firestore` (T48 del spec de
 * horas en eventos).
 */
export const eventRepositoryContext = createContext<
	EventRepositoryPort | undefined
>(Symbol("planu-event-repository"));

/** El puerto de almacén de imágenes, no `FirebaseStorage`. Mismo motivo. */
export const imageStoreContext = createContext<ImageStorePort | undefined>(
	Symbol("planu-image-store"),
);

/**
 * Sesión actual. Los tres estados importan y no deben colapsarse:
 * `undefined` = todavía comprobando, `null` = sin sesión, `SessionUser` =
 * autenticado. Confundir "comprobando" con "sin sesión" provoca un parpadeo
 * al login.
 *
 * Expone el tipo de dominio, no el `User` de Firebase: es lo que permite a
 * `app-shell.ts` y `profile-view.ts` dejar de importar `firebase/auth`.
 */
export const userContext = createContext<SessionUser | null | undefined>(
	Symbol("planu-user"),
);
