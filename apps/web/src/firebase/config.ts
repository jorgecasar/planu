import type { FirebaseOptions } from "firebase/app";

/**
 * La base de Firestore de este proyecto NO es la `(default)`.
 * Sin este identificador el SDK lee de una base que no existe.
 */
export const DATABASE_ID = "planu";

/**
 * Configuración del cliente, leída de .env.local (no versionado).
 *
 * Los valores se obtienen con:
 *   firebase apps:sdkconfig WEB 1:854295039681:web:1181b841906dba24160e40 \
 *     --project planu-app
 *
 * No son secretos —viajan en el bundle del cliente— pero no se versionan para
 * que cada entorno apunte a su propio proyecto.
 */
export const firebaseConfig: FirebaseOptions = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Puertos de los emuladores. Deben coincidir con firebase.json.
 *
 * Firestore no usa el 8080 por defecto ni Hosting el 5000: en macOS el 5000 lo
 * ocupa el receptor AirPlay del sistema, y el 8080 suele estar cogido.
 */
export const EMULATORS = {
	auth: 9099,
	firestore: 8181,
	storage: 9199,
} as const;
