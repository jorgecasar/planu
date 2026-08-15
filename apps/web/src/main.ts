import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";

import { initLocale } from "./i18n/localization.js";
import { captureStartupErrors } from "./observability/startup-buffer.js";

// Lo primero de todo, y síncrono: a partir de aquí cualquier error queda
// guardado aunque el SDK de Sentry tarde segundos en cargar.
captureStartupErrors();

// El idioma se fija antes de registrar los componentes: si la aplicación
// pintara primero y cambiara después, el usuario vería el salto de inglés a su
// idioma. `document.documentElement.lang` importa para lectores de pantalla y
// para la traducción automática del navegador.
//
// Este `await` va antes de los import() a propósito, y no se puede paralelizar
// con ellos: un import() **ejecuta** el módulo al cargarlo, y ejecutar
// `app-shell.js` registra los componentes, que se pintarían en el idioma que
// hubiera en ese momento. Adelantar sólo la descarga es cosa de
// `modulepreload`, no de import().
const locale = await initLocale();
document.documentElement.lang = locale;

// Estos dos sí van en paralelo: son independientes entre sí —`app-shell` no
// importa el provider; los une el marcado de index.html— y encadenarlos con
// `await` añadía una onda de red a la ruta crítica.
const [{ initializeFirebase }] = await Promise.all([
	import("./firebase/firebase-provider.js"),
	import("./app-shell.js"),
]);

// Con la aplicación ya en pie: la observabilidad no debe competir por el
// primer pintado. Dentro espera además a que el navegador esté ocioso.
const { startObservability } = await import("./observability/index.js");
startObservability(initializeFirebase().app);
