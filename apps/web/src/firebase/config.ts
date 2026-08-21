import type { FirebaseOptions } from "firebase/app";

/**
 * This project's Firestore database is NOT the `(default)` one.
 * Without this identifier the SDK reads from a database that does not exist.
 */
export const DATABASE_ID = "planu";

/**
 * Client configuration, read from .env.local (not versioned).
 *
 * The values are obtained with:
 *   firebase apps:sdkconfig WEB 1:854295039681:web:1181b841906dba24160e40 \
 *     --project planu-app
 *
 * They are not secrets —they travel in the client bundle— but they are not
 * versioned so that each environment points to its own project.
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
 * Emulator ports. Must match firebase.json.
 *
 * Firestore does not use the default 8080, nor Hosting the default 5000: on
 * macOS 5000 is taken by the system's AirPlay receiver, and 8080 is usually
 * taken too.
 */
export const EMULATORS = {
	auth: 9099,
	firestore: 8181,
	storage: 9199,
} as const;
