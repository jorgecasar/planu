# Spec · El pipeline debe fallar cuando falla un test

## Actualización 23/08/2026 — la causa raíz no era sólo los reintentos

Quitar `retries` (ver más abajo) seguía siendo necesario, pero no es lo que
arregla los e2e: es lo que deja de esconderlos. Investigando por qué,
apareció un bug real y más grave.

**Confirmado contra la producción real**, no supuesto: un script de Playwright
que abre una sesión de navegador nueva contra
`https://planu-app.web.app/app/login` y espera hasta 20 s, repetido 8 veces
sin nada compartido entre repeticiones (cada una es un `chromium.launch()`
propio) —

```
run 1: first spinner at 374 ms, resolved at STILL STUCK after 20s
run 2-8: resuelven todas entre 360 y 510 ms
```

— **1 de 8 arranques se queda permanentemente** en el spinner «Checking your
session» (`app-shell.ts`, el estado `this.user === undefined`). Sin ningún
error de consola y sin ninguna petición de red fallida: capturando consola y
red completas, lo único que aparece es una llamada de Analytics abortada
(irrelevante) y las llamadas normales a `firebaseinstallations.googleapis.com`
/ `firebase.googleapis.com` (remote config, fireperf). **No hay ninguna
llamada a `identitytoolkit.googleapis.com` ni a `securetoken.googleapis.com`
en ninguna de las 8 corridas** — con una sesión de navegador nueva sin nada
persistido, el SDK decide `onAuthStateChanged(null)` mirando sólo IndexedDB,
sin red. En la corrida que se queda colgada, esa lectura de IndexedDB nunca
llega a disparar el callback.

Esto encaja mucho mejor con el patrón medido en el run de CI real
(`32602746219`): 10 de 83 e2e fallando siempre justo tras
`page.goto("/app/login")`, repartidos por toda la corrida, no agrupados — una
tasa de fallo intermitente en el arranque de sesión, no contención de
paralelismo.

**Descartado como causa, verificado, no supuesto:** un primer intento de
reproducirlo en local salió 100% reproducible (8/8, y luego 6/6) contra el
servidor de desarrollo — pero resultó ser un problema de entorno de este
worktree, no del código: se había recreado sin `.env.local` (hueco ya conocido,
ver la memoria del agente «Worktrees paralelos en planu»), y con la API key
inválida el fallo es total y no dice nada sobre el bug real. Con el
`.env.local` restaurado, la reproducción local queda pendiente de repetir.

**Hipótesis, no confirmada todavía:** `initializeFirebase()` en
`firebase-provider.ts` llama a
`initializeAuth(app, { persistence: [indexedDBLocalPersistence,
browserLocalPersistence] })`. Hay incidencias documentadas en
`firebase-js-sdk` (versión instalada: `12.17.1`) de `onAuthStateChanged`
colgándose o no disparando nunca con configuraciones de persistencia múltiple
que incluyen IndexedDB — ver
[firebase-js-sdk#8626](https://github.com/firebase/firebase-js-sdk/issues/8626),
[#8545](https://github.com/firebase/firebase-js-sdk/issues/8545) y
[#5874](https://github.com/firebase/firebase-js-sdk/issues/5874). Ninguno es
un calco exacto de este síntoma; sirven como precedente de que la
combinación es frágil, no como diagnóstico cerrado.

**Resuelto — ver «Investigación de causa raíz» y «Corrección importante» más
abajo para el desarrollo completo.** Resumen: la causa exacta dentro del SDK
no se identificó (desproporcionado sin instrumentar el bundle minificado);
el arreglo elegido con el usuario es un timeout de seguridad en
`app-shell.ts`, ya implementado; y se confirmó que este hallazgo **no**
explica la inestabilidad de CI — son dos causas independientes.

## Objetivo (alcance original, sigue vigente)

El job `verify` de `.github/workflows/ci.yml` puede terminar en verde con
tests e2e que fallaron en su primer intento. `apps/web/playwright.config.ts`
tiene `retries: process.env["CI"] ? 2 : 0`: si un test falla y pasa al
reintentar, Playwright lo cuenta como *flaky*, no como *failed*, y el proceso
sale con código 0. El job de CI sólo mira ese código de salida, así que un
pipeline «verde» hoy no significa «todos los tests pasaron a la primera» —
significa «todos los tests pasaron, alguna vez, en como mucho tres intentos».

Un pipeline que no puede fallar por esto no tiene utilidad como puerta de
calidad: es exactamente el patrón que `AGENTS.md` (sección «Verificar de
verdad», punto 2) ya señala como peor que no tener test ninguno.

**Éxito** = `npm run test:e2e` con cero reintentos en CI; un solo fallo en un
solo test hace fallar el job; y se ha demostrado —no supuesto— que hoy con
esta config el job puede salir en verde con un fallo real escondido dentro,
rompiéndolo a propósito antes de aplicar el arreglo y confirmando que dejó de
poder pasar así después.

## Diagnóstico ya hecho, no una hipótesis

Verificado contra el run real `32602746219` (push a `main` tras fusionar T40,
22/08/2026): 83 tests e2e, `1 worker` (Playwright reduce a 1 automáticamente
bajo `CI`, aunque `fullyParallel: true` esté puesto), 10 marcados *flaky*.
Los 10 fallan en el mismo punto exacto — justo tras `page.goto("/app/login")`,
esperando el título `planu`, la pestaña «Create account» o el campo de email,
con `Test timeout of 30000ms exceeded` — y los 10 pasan al primer reintento en
2–9 s, frente a los ~30 s del intento que falló. Repartidos a lo largo de toda
la corrida (test 1 a 79 de 83), no agrupados al principio: no es sólo un
arranque en frío del primer test.

No es el problema de contención en paralelo entre worktrees que documenta
`AGENTS.md`: este run no tiene paralelismo propio que comparar. Es un
problema **de estabilidad de la app o del servidor de desarrollo bajo el
runner de GitHub Actions**, con timeout justo en el margen.

## No tocar en esta tarea

Por decisión explícita: no se sube el timeout de test ni el de navegación de
Playwright. Se deja en el valor por defecto (30 s) mientras se ve qué falla
de verdad sin la máscara de los reintentos. Si tras quitar `retries` algún
test falla de forma consistente por timeout corto —no ocasional—, se decide
entonces si la causa es ese margen o algo más, en vez de subirlo a ciegas
ahora.

## Alcance

- `apps/web/playwright.config.ts` — la app (`e2e/*.spec.ts`).
- `apps/web/playwright.landing.config.ts` — la landing, sólo si al verificar
  aparece el mismo problema ahí. No se toca si no hace falta.
- `.github/workflows/ci.yml` — sólo si la propia configuración del job
  necesita cambiar para que un fallo real haga fallar el step (por ejemplo,
  si `emulators:exec` estuviera tragando el código de salida de la suite
  interna — a comprobar, no asumido).

Fuera de alcance: cualquier otro test unitario, de reglas o de arquitectura.
Ya fallan el pipeline correctamente si fallan — el problema es específico de
e2e con reintentos.

**Ampliado tras la investigación** (ver «Investigación de causa raíz» más
abajo): `apps/web/src/app-shell.ts` y el nuevo
`apps/web/src/domain/session-check-timeout.ts`, para el timeout de
seguridad del cuelgue de sesión en producción. No se tocó
`firebase-provider.ts` ni ningún fichero de `infrastructure/firebase/`.

## Cambio propuesto

`retries: process.env["CI"] ? 2 : 0` → `retries: 0` (o eliminar la línea, ya
que `0` es el valor por defecto de Playwright). Sin reintentos, cualquier
fallo en cualquier intento hace que Playwright salga con código distinto de
cero, y el step de CI falla — sin necesidad de leer o interpretar el reporte
JSON de Playwright.

## Comandos

```bash
npm run test:e2e                         # local, ver tasa real de fallo sin retries
npm run test:e2e -- --repeat-each=1      # repetir para confirmar estabilidad, si hace falta
npm run lint && npm run typecheck        # no tocado por este cambio, pero de higiene
```

En CI, la verificación real es un push/PR contra este cambio y leer el
resultado del job (`gh run view <id> --json conclusion,jobs` o equivalente),
no asumir por el diff que va a funcionar.

## Estrategia de verificación — en dos pasos, por orden explícita del usuario

1. **Local primero.** Con `retries: 0`, correr `npm run test:e2e` completo
   contra los emuladores. Si algo falla de forma repetible (no una vez suelta
   por carga de la máquina compartiendo emuladores con otras sesiones — ver
   `AGENTS.md` sobre worktrees en paralelo), es un fallo real que se corrige
   aquí, no se deja pendiente: la petición es que pasen todos los tests, no
   sólo que el pipeline sea honesto sobre si pasan.
2. **Sólo cuando lo anterior esté estable, CI real.** Push a una rama, PR,
   dejar correr el job, y comprobar el código de salida real
   (`gh run view --json conclusion`), no la lectura visual del log. Antes de
   dar el arreglo por bueno, romperlo a propósito una vez —revertir
   `retries: 0` temporalmente, o forzar un fallo en un test cualquiera sin
   reintento posible— y confirmar que **ese** run sí falla. Sin esa mitad, la
   regla no está probada, tal como exige `AGENTS.md` para el propio trinquete
   de `arch/boundary.test.ts`.

## Boundaries

- **Siempre**: verificar por código de salida (`$?` o el `conclusion` de la
  API de GitHub), nunca por lectura del texto del log — ya ha costado un
  incidente registrado en `AGENTS.md`.
- **Preguntar primero**: si local revela un fallo real y consistente cuya
  causa no es evidente (no el patrón ya diagnosticado de `/app/login`), antes
  de decidir un arreglo estructural distinto al de esta tarea.
- **Nunca**: subir el timeout como forma de esconder un fallo real en vez de
  corregirlo; volver a poner `retries > 0` en CI como parche si algo resulta
  inestable — eso es exactamente lo que esta tarea existe para quitar.

## Criterios de éxito

1. `apps/web/playwright.config.ts` tiene `retries: 0` (o ausente) bajo CI.
2. `npm run test:e2e` en local, repetido, pasa sin ningún reintento —o los
   fallos que aparezcan se han corregido, no escondido.
3. Un run de CI real, tras el cambio, termina con `conclusion: success` y
   cero tests marcados *flaky* en su reporte.
4. Se ha demostrado, con un run real, que un fallo sin reintento posible hace
   fallar el job — el trinquete está probado, no supuesto.
5. **Nuevo, tras la actualización de arriba — objetivo de producción, no de
   CI** (ver la corrección más abajo: el cuelgue no se reproduce contra el
   emulador, así que no mueve la aguja del pipeline): el spinner infinito de
   `app-shell.ts` deja de ser posible. Verificado con un test unitario que
   simula que `onAuthStateChanged` nunca dispara y comprueba que, pasado el
   timeout, se muestra la salida de recarga en vez del spinner indefinido.

## Preguntas abiertas

Ninguna. Las dos decisiones originales de diseño (sin reintentos, sin tocar
el timeout de test) y la forma del arreglo del cuelgue de sesión (timeout de
seguridad) están confirmadas por el usuario e implementadas — ver las
secciones de abajo.

## Investigación de causa raíz — cerrada, sin causa exacta identificada

**Método:** un script de Playwright (`chromium.launch()` nuevo por corrida,
sin nada compartido) que espera hasta 20 s a que desaparezca el spinner
«Checking your session» y captura consola, red y promesas no atendidas.

**Muestra 1 — producción real (`https://planu-app.web.app/app/login`), dos
tandas en momentos distintos de carga de esta máquina:**

| Tanda | Corridas | Atascadas |
| --- | --- | --- |
| Carga alta (load avg ~6) | 8 | 1 (12,5 %) |
| Carga baja (load avg ~1,7) | 15 | 4 (26,7 %) |
| **Total** | **23** | **5 (21,7 %)** |

**Muestra 2 — build de producción real (`vite build`, mismo código, sin
emulador) servido en `localhost` y contra el backend real de Firebase, no
uno de prueba:** **18 de 18 corridas atascadas (100 %)**, en dos tandas
(15 + 3) bajo carga *baja* de la máquina — descarta que sea contención de
esta máquina compartida, porque la tanda local con más fallos corrió con
**menos** carga que la de producción con menos fallos.

**Instrumentado con el segundo argumento de error de `onAuthStateChanged` y
un listener global de `unhandledrejection`: ninguno de los dos disparó
nunca**, ni en las corridas que se atascan. No es una promesa rechazada que
se pierde por no tener manejador — es un cuelgue real, sin ninguna señal
observable desde fuera del SDK.

**Conclusión:** hay una diferencia real y grande entre origen de producción
(`planu-app.web.app`, ~22 % de fallo) y un origen no autorizado del mismo
proyecto (`localhost`, 100 % de fallo), pero producción **también falla de
verdad**, así que el origen agrava el problema, no lo explica entero. La
causa exacta vive dentro de la resolución de persistencia de
`firebase-js-sdk` 12.17.1 (`initializeAuth` con
`[indexedDBLocalPersistence, browserLocalPersistence]`), sin visibilidad
posible desde fuera del bundle minificado sin instrumentar el propio SDK
—fuera de proporción para esta tarea—. Los tres issues de
`firebase-js-sdk` citados arriba son precedente de fragilidad en esa misma
combinación, no una causa confirmada.

**Afinado tras una pregunta del usuario: ¿y si es sólo la primera visita de
ese navegador?** Todas las corridas de arriba usaban un perfil de
navegador **nuevo** en cada intento (`chromium.launch()` propio, sin nada
compartido), para no contaminar entre corridas — pero eso significa que
también eran, sin querer, siempre «primera visita nunca antes vista» al
origen. Contraprueba, en la misma ventana temporal: **un único navegador,
recargando la misma página 8 veces seguidas (mismo IndexedDB, misma caché,
como refrescar de verdad) → 0 de 8 atascos**, frente a **2 de 10 con perfil
nuevo en cada intento, corridos justo al lado**. El cuelgue es específico de
la **primera vez que ese navegador crea la base de IndexedDB de Auth contra
el backend real** — una vez existe, las recargas van limpias. Esto también
explica por qué el emulador nunca lo reproduce: ahí no hay ese primer
contacto real con el backend de Firebase que crear.

Consecuencia práctica: la población más expuesta no es «el 20 % de las
visitas», es **quien visita por primera vez sin perfil previo** —
registros nuevos, el momento de peor impacto posible para perder a alguien
con un spinner roto—. Refuerza, no cambia, la recomendación del timeout de
seguridad.

**Recomendación, aceptada por el usuario (timeout de seguridad):** en vez de
perseguir la causa exacta dentro del SDK, añadir una red de seguridad en
`app-shell.ts`: si `onAuthStateChanged` no dispara en N segundos (con
margen sobre el ~300 ms que tardan las corridas que sí funcionan), tratar
la sesión como desconocida y ofrecer una salida —recargar— en vez de un
spinner infinito.

## Corrección importante: esto NO explica la inestabilidad de CI

**Verificado antes de implementar nada, para no arreglar el síntoma
equivocado:** el mismo script de sondeo contra el **emulador** de Auth
(`http://localhost:3061/app/login`, `.env.local` correcto, backend de
Firebase real sustituido por `connectAuthEmulator`) dio **12 de 12
corridas resueltas en ~290 ms, cero atascos**. El cuelgue es exclusivo del
backend real de Firebase Auth (producción) y **no se reproduce contra el
emulador**, que es lo único contra lo que corren `test:e2e` y CI.

Esto separa las dos tareas que este documento llegó a mezclar:

1. **La política de reintentos** (sección original de arriba) sigue siendo
   necesaria y suficiente para que el pipeline no pueda salir en verde con
   un fallo real escondido — eso no dependía de esta investigación.
2. **El cuelgue de sesión en producción** es un hallazgo real y de impacto
   —usuarios reales atascados—, pero **no** es la causa de los 10/83 e2e
   fallando en el run `32602746219`. Esa causa sigue sin explicación
   confirmada; la hipótesis más simple que queda en pie es contención de
   recursos en el runner de GitHub Actions, ya apuntada en el diagnóstico
   original, y no se investiga más en este documento.

El arreglo del timeout de seguridad se hace igualmente porque el hallazgo es
real y vale la pena, **no** porque vaya a estabilizar CI — no se debe
prometer eso al reportarlo.
