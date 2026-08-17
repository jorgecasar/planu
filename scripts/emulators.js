/**
 * Arranca los emuladores conservando los datos entre reinicios.
 *
 * Sin esto, cada reinicio se lleva por delante las cuentas y los eventos, y hay
 * que volver a sembrar. Costó una sesión entera de «no me autentica»: la cuenta
 * simplemente había dejado de existir.
 *
 * Es un script y no una bandera suelta en `package.json` porque `--import`
 * **falla** si el directorio no existe o no tiene el `firebase-export-metadata.json`
 * que escribe la exportación. La primera vez no hay nada que importar, así que
 * la bandera sólo se añade cuando hay algo válido que leer.
 *
 * **La exportación sólo ocurre si los emuladores salen limpiamente** (Ctrl-C, o
 * cualquier señal que puedan atender). Un `kill -9` se lleva los datos igual.
 *
 * Y lo que **no** conserva, que conviene saber antes de extrañarse: la
 * exportación de Firestore sólo cubre la base **`(default)`**, y la de este
 * proyecto se llama `planu` (ver `firebase.json`). Comprobado escribiendo un
 * documento en cada una: tras reiniciar sobrevive el de `(default)` y
 * desaparece el de `planu`.
 *
 * O sea: **las cuentas sí sobreviven —que es lo que rompía el acceso— y los
 * eventos no.** Para eso está `npm run seed`, que los vuelve a poner en un
 * comando.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `fileURLToPath` y no `import.meta.dirname`, que exige Node ≥20.11 mientras
// `engines` declara `>=20`.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATOS = join(RAIZ, ".emulator-data");

const args = ["emulators:start", "--export-on-exit", DATOS];

// Sólo se importa lo que de verdad es una exportación. Un directorio vacío —el
// primer arranque, o uno que quedó a medias— haría abortar el emulador.
if (existsSync(join(DATOS, "firebase-export-metadata.json"))) {
	args.push("--import", DATOS);
} else {
	console.log(
		"Sin datos previos que importar: esta vez arranca en blanco y exporta al salir.",
	);
}

const emuladores = spawn("firebase", args, {
	cwd: RAIZ,
	stdio: "inherit",
	shell: process.platform === "win32",
});

emuladores.on("exit", (code, signal) => {
	// Se propaga la señal en vez de tragarla: quien lanzó esto espera que Ctrl-C
	// se comporte como Ctrl-C.
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
