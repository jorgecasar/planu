import { createContext } from "@lit/context";
import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

/** La app en sí; la necesita Firebase AI Logic, que no cuelga de Firestore. */
export const appContext = createContext<FirebaseApp | undefined>(
	Symbol("planu-app-instance"),
);

export const authContext = createContext<Auth | undefined>(
	Symbol("planu-auth"),
);

export const firestoreContext = createContext<Firestore | undefined>(
	Symbol("planu-firestore"),
);

export const storageContext = createContext<FirebaseStorage | undefined>(
	Symbol("planu-storage"),
);

/**
 * Sesión actual. Los tres estados importan y no deben colapsarse:
 * `undefined` = todavía comprobando, `null` = sin sesión, `User` = autenticado.
 * Confundir "comprobando" con "sin sesión" provoca un parpadeo al login.
 */
export const userContext = createContext<User | null | undefined>(
	Symbol("planu-user"),
);
