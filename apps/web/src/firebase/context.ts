import { createContext } from "@lit/context";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

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
