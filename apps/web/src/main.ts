import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "./styles/theme.css";

import { captureStartupErrors } from "./domain/startup-buffer.js";
import { initLocale } from "./i18n/localization.js";

// The very first thing, and synchronous: from here on any error stays
// captured even if the Sentry SDK takes seconds to load.
captureStartupErrors();

// The language is set before the components are registered: if the
// application painted first and changed afterward, the user would see the
// jump from English to their language. `document.documentElement.lang`
// matters for screen readers and for the browser's automatic translation.
//
// This `await` comes before the import()s on purpose, and cannot be
// parallelized with them: an import() **executes** the module as it loads
// it, and executing `app-shell.js` registers the components, which would
// render in whatever language was in effect at that moment. Getting ahead
// of just the download is what `modulepreload` is for, not import().
const locale = await initLocale();
document.documentElement.lang = locale;

// These two do go in parallel: they are independent of each other —
// `app-shell` does not import the provider; index.html's markup is what
// links them— and chaining them with `await` added a network round trip to
// the critical path.
const [{ initializeFirebase }] = await Promise.all([
	import("./firebase/firebase-provider.js"),
	import("./app-shell.js"),
]);

// With the application already up: observability must not compete for the
// first paint. Inside, it also waits for the browser to be idle.
const { startObservability } = await import("./observability/index.js");
startObservability(initializeFirebase().app);
