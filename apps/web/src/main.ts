import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/styles/themes/default.css";

import { initLocale } from "./i18n/localization.js";

// El idioma se fija antes de registrar los componentes: si la aplicación
// pintara primero y cambiara después, el usuario vería el salto de inglés a su
// idioma. `document.documentElement.lang` importa para lectores de pantalla y
// para la traducción automática del navegador.
const locale = await initLocale();
document.documentElement.lang = locale;

await import("./firebase/firebase-provider.js");
await import("./app-shell.js");
