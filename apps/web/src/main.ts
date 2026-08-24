import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "./styles/theme.css";

import { ContextRoot } from "@lit/context";
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
// the critical path. But parallel loading means either chunk can finish
// evaluating first, and both `<planu-app>` and `<planu-firebase-provider>`
// are already present in the static markup — so whichever one's module
// resolves first upgrades its element immediately. If `app-shell` wins,
// `<planu-app>`'s `@consume({subscribe: true})` for `userContext` dispatches
// its one-shot `context-request` before `firebase-provider`'s
// `ContextProvider` has attached its listener, and `@lit/context` never
// retries a request that finds no provider — the session stays stuck on
// `undefined` forever, with no error and no network call. `ContextRoot` is
// the library's own fix for a consumer connecting before its provider: it
// buffers any unanswered subscribing request and replays it once a matching
// provider announces itself. Attaching it here, before either import()
// starts, means it is listening no matter which chunk wins the race.
new ContextRoot().attach(document.body);

const [{ initializeFirebase }] = await Promise.all([
	import("./firebase/firebase-provider.js"),
	import("./app-shell.js"),
]);

// With the application already up: observability must not compete for the
// first paint. Inside, it also waits for the browser to be idle.
const { startObservability } = await import("./observability/index.js");
startObservability(initializeFirebase().app);
