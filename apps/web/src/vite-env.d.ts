/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_FIREBASE_API_KEY: string;
	readonly VITE_FIREBASE_AUTH_DOMAIN: string;
	readonly VITE_FIREBASE_PROJECT_ID: string;
	readonly VITE_FIREBASE_STORAGE_BUCKET: string;
	readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
	readonly VITE_FIREBASE_APP_ID: string;
	/**
	 * Interruptor global de la inferencia en la nube, que factura por token.
	 * "true" la habilita para las cuentas con derecho; cualquier otro valor la
	 * cierra para todas. Ver src/events/ai-policy.ts.
	 */
	readonly VITE_AI_CLOUD_FALLBACK?: string;
	/** DSN de Sentry. Sin él no se envía nada: la observabilidad es opcional. */
	readonly VITE_SENTRY_DSN?: string;
	/** Versión desplegada, para agrupar errores por release. */
	readonly VITE_RELEASE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
