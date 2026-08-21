import { createContext } from "@lit/context";
import type { FirebaseApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import type { SessionPort, SessionUser } from "../application/ports/session.js";

/** The app itself; needed by Firebase AI Logic, which does not hang off Firestore. */
export const appContext = createContext<FirebaseApp | undefined>(
	Symbol("planu-app-instance"),
);

/**
 * The session port, not `Auth`: whoever consumes this context doesn't know
 * Firebase exists. See `application/ports/session.ts`.
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
 * Current session. The three states matter and must not be collapsed:
 * `undefined` = still checking, `null` = no session, `SessionUser` =
 * authenticated. Confusing "checking" with "no session" causes a flicker to
 * the login.
 *
 * Exposes the domain type, not Firebase's `User`: that's what lets
 * `app-shell.ts` and `profile-view.ts` stop importing `firebase/auth`.
 */
export const userContext = createContext<SessionUser | null | undefined>(
	Symbol("planu-user"),
);
