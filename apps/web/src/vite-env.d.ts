/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_FIREBASE_API_KEY: string;
	readonly VITE_FIREBASE_AUTH_DOMAIN: string;
	readonly VITE_FIREBASE_PROJECT_ID: string;
	readonly VITE_FIREBASE_STORAGE_BUCKET: string;
	readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
	readonly VITE_FIREBASE_APP_ID: string;
	/**
	 * Global switch for cloud inference, which bills per token.
	 * "true" enables it for accounts with the right; any other value closes
	 * it for everyone. See src/domain/ai-policy.ts.
	 */
	readonly VITE_AI_CLOUD_FALLBACK?: string;
	/** Sentry DSN. Without it nothing is sent: observability is optional. */
	readonly VITE_SENTRY_DSN?: string;
	/**
	 * GA4 measurement ID. Without it, `initAnalytics()` (T31, ADR 0009) does
	 * nothing: the repo works with no Analytics account configured.
	 */
	readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
	/** Deployed version, to group errors by release. */
	readonly VITE_RELEASE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
