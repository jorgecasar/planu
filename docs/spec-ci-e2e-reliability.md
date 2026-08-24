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

## No tocar en esta tarea — decisión revisada más abajo con evidencia real

Por decisión explícita: no se sube el timeout de test ni el de navegación de
Playwright. Se deja en el valor por defecto (30 s) mientras se ve qué falla
de verdad sin la máscara de los reintentos. Si tras quitar `retries` algún
test falla de forma consistente por timeout corto —no ocasional—, se decide
entonces si la causa es ese margen o algo más, en vez de subirlo a ciegas
ahora.

**Revisado tras tres runs reales de CI con el mismo patrón** (ver «El
trinquete de reintentos ya se probó en un run real» más abajo): con
`vmstat` corriendo durante una de esas corridas, el runner reportó
**`nproc` = 2** y **9,1 % de los segundos muestreados con menos del 10 % de
CPU libre (5,1 % exactamente al 0 %)**, con Node, dos JVMs (Firestore y las
reglas de Storage) y Chromium compartiendo esos dos núcleos. Con esa
medición como justificación —no una suposición—, el usuario aprobó subir
`timeout` a 60 s y `expect.timeout` a 10 s en `playwright.config.ts`. No es
esconder un fallo: con `retries: 0` en pie, un cuelgue real seguiría
fallando, sólo que con el margen que la propia máquina ya ha demostrado
necesitar.

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
6. **Nuevo, tras tres runs reales de CI:** el margen de 30 s se subió a 60 s
   (y `expect.timeout` a 10 s), con `nproc = 2` y datos de `vmstat` como
   justificación medida — no supuesta. Pendiente de un cuarto run que lo
   confirme; el criterio 3 («cero tests *flaky*») se da por parcialmente
   cumplido en el sentido de que el trinquete funciona, no en el de que el
   runner haya dejado de tener menos CPU de la que el conjunto de
   emuladores + Vite + Chromium necesitaría idealmente.

## Segundo hallazgo del mismo tipo: `lint:lit` tampoco podía fallar

Encontrado por el usuario revisando el propio log de CI de esta PR: el paso
«Calidad estática» corre `lit-analyzer src`, y ese comando **sale con código
0 en cuanto no hay ningún error**, sin importar cuántos avisos («warnings»)
reporte. Verificado empíricamente: `npx lit-analyzer src` con el aviso
preexistente de `landing/legal.ts` presente → `EXIT=0`. Es exactamente el
mismo patrón que el problema original de este documento — un paso de CI que
no puede fallar por el problema que dice vigilar—, sólo que en `lint:lit` en
vez de en `test:e2e`.

Dos partes, no una:

1. **El aviso en sí era real, aunque inofensivo.** `legal.ts:23` tenía
   `href="${LOCALE_PREFIX}/"`, y `lit-analyzer` marca `no-unintended-mixed-
   binding` cuando una expresión queda directamente pegada a una `/`. El
   resultado final era correcto —`LOCALE_PREFIX` se sustituye en build a
   `""` o `/{locale}`, así que la URL sale bien en ambos casos— pero
   construir el valor fuera de la plantilla (`const backHref =
   \`${LOCALE_PREFIX}/\`;`) produce el mismo HTML y evita el falso positivo
   sin tocar el comportamiento. `npx lit-analyzer src` → **0 problemas**
   tras el cambio.
2. **`--maxWarnings 0` añadido al script `lint:lit`** de
   `apps/web/package.json`, para que un aviso nuevo sí falle el paso de CI
   en el futuro — no sólo para este caso concreto. Nuevo
   `arch/lint-lit-cant-pass-silently.test.ts` vigila que el flag no
   desaparezca del script, mismo patrón que `arch/ci-retries.test.ts`. Roto
   a propósito (quitando el flag) → **1 fallo**; restaurado → **0**.

Verificación completa tras el arreglo: `npm run lint:lit` → **0**, «Found 0
problems in 121 files»; `npm run test:arch` → **0**, **16/16** (15 → 16, el
test nuevo); `npm test` → **0**, 555/555 (sin cambios, este hallazgo no
tocó tests de aplicación); `npx tsc --noEmit`, `npx @biomejs/biome check .`
y `npm run build` → **0** cada uno.

## Preguntas abiertas

Obsoleto — ver «`test:e2e` sale de CI, de momento» al final del documento
para el estado final. Se deja sin borrar, como pide `AGENTS.md`, porque
documenta que la decisión de no tocar el timeout se revisó más tarde con
datos reales, no que nunca existiera.

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

## El trinquete de reintentos ya se probó en un run real — y falló de verdad

Con el commit de arriba en la PR #59, dos runs reales de CI (`32635238325`,
antes y después de un `gh run rerun` sin tocar nada) confirman el criterio 4
de éxito: **10/83 y luego 8/83 e2e fallaron de verdad, y el job salió en
`failure` las dos veces** — el trinquete funciona en ambos sentidos.

**Ambas tandas comparten el mismo patrón**: `Test timeout of 30000ms
exceeded` esperando algo en `/app/login` (la pestaña «Create account»/«Crear
cuenta», el campo de email, o el botón «Sign in»), en tests de ficheros
distintos cada vez (ai, auth, calendar-export, events, i18n, profile,
sharing, smoke, views — nunca los mismos dos runs). No es un test roto: es
el propio arranque de `/app/login` tardando más de 30 s de forma
intermitente bajo el runner de GitHub Actions.

**Se añadió `vmstat` al paso «Tests con emuladores» de `.github/workflows/ci.yml`**,
en paralelo y subido como artefacto sólo si el job falla, para tener CPU/RAM
reales del runner la próxima vez que esto pase — antes de este cambio no
había forma de saber si era contención o alguna otra causa, sólo se podía
suponer.

**Simulación local, y una corrección importante sobre `CI=true`:**
`process.env["CI"]` puesto a mano en esta máquina dio **5 workers**, no 1 —
`CI=true` por sí solo no reduce la concurrencia de Playwright. El «1 worker»
del run real (confirmado leyendo el log: `Running 83 tests using 1 worker`)
es consecuencia de que el runner de GitHub Actions tiene pocos núcleos, no
un modo especial que Playwright active al detectar CI. Forzando
`--workers=1` a mano localmente, la suite completa pasó **75/83 y 77/83**
en dos corridas —sin el patrón de `/app/login`—, con un puñado de fallos
en `sharing.spec.ts` que **no** eran ese patrón (ver más abajo). Conclusión:
la concurrencia por sí sola no reproduce el problema; hace falta además la
escasez real de CPU del runner, que esta máquina no tiene y no se puede
simular sin herramientas de las que macOS carece (`taskset`/`cgroups`, sólo
Linux).

### Hallazgo aparte, investigado y descartado: `sharing.spec.ts` bajo `--workers=1`

Las corridas locales con `--workers=1` fallaban de forma consistente (7 de
9 tests) en `sharing.spec.ts`, con el error genérico «The invitation could
not be saved». La hipótesis inicial —una carrera entre `signIn()` (que
dispara `publishDirectoryEntry()` como `void`, sin esperar) y la invitación
inmediata al invitado— parecía encajar con el propio comentario del test
(«the guest signs in first: doing so publishes them to the directory»), y
se implementó un `waitForDirectoryEntry()` que sondea el emulador
directamente (mismo patrón que `promoteToEditor()`).

**Se descartó con una prueba de control, no se dio por buena a ciegas.**
Instrumentando el error real (`console.error` temporal, ya revertido) salió
`FirebaseError: evaluation error ... Null value error` dentro de
`ownerEditsWhilePending()` en `firestore.rules` — una función de `allow
update` evaluándose con `resource == null`, como si fuera un `create`
recién hecho. Se comprobó que las reglas cargadas coincidían exactamente con
las del worktree (`diff` sin diferencias), así que no era un problema de
reglas obsoletas. La causa real: **el emulador compartido de esta máquina
llevaba corriendo desde el sábado**, acumulando datos de sesiones de todo
el día. Reiniciado en caliente (`SIGINT`, exporta limpio; `SIGKILL` no lo
habría hecho), la suite completa de `sharing.spec.ts` pasó **9/9** —con y
sin el `waitForDirectoryEntry()` añadido—, confirmando que la carrera nunca
fue la causa real. **El cambio especulativo se revirtió**: no se deja
código sin un fallo real que justifique su existencia.

Ninguno de los dos hallazgos de `sharing.spec.ts` tiene relación con el
patrón de `/app/login` de CI, que sigue sin explicación confirmada más allá
de la contención de CPU del runner.

## Subir el timeout, probado en un tercer y cuarto run — mejora parcial, no cierre

Un tercer run real (`32661264258`) repitió el mismo patrón (ficheros
distintos otra vez). Con el `vmstat` del commit anterior ya activo, el
artefacto dio números reales por primera vez: **`nproc` = 2** en el runner,
y de 685 muestras de un segundo, **62 (9,1 %) con menos del 10 % de CPU
libre, 35 (5,1 %) exactamente al 0 %** — contención medida, con Node, dos
JVMs (Firestore y las reglas de Storage) y Chromium compartiendo esos dos
núcleos.

Con esa medición, y aprobación explícita del usuario para revisar la
decisión original de no tocar el timeout, se subió `timeout` de 30 s a 60 s
y `expect.timeout` de 5 s a 10 s en `playwright.config.ts`. Un cuarto run
(`32662816239`) dio **mejora parcial, no una solución**: de 8-10 fallos
bajó a **6**, pero esos 6 agotaron el minuto completo entero esperando el
mismo clic (`getByRole('tab', {name: 'Create account'})`) que en local
resuelve en menos de un segundo. El `vmstat` de este cuarto run mostró
contención **similar**, no peor, que el tercero (9,9 % / 6,0 %) —
descartando que el empeoramiento explicara por qué 60 s tampoco bastó para
esos 6.

**Lectura honesta de los cuatro runs**: un click que no resuelve en 60 s
enteros con contención de CPU que no empeoró respecto al run anterior se
parece más a un cuelgue no acotado —de la misma familia que el de
`onAuthStateChanged` encontrado antes en producción, nunca descartado
específicamente contra el emulador en las condiciones reales de red/DNS
del runner de GitHub Actions, sólo desde esta máquina— que a contención
lenta y acotada. Subir el timeout otra vez habría comprado, como mucho,
otra mejora parcial al precio de minutos de pipeline adicionales.

## `test:e2e` sale de CI, de momento

Decisión del usuario ante el coste (8-10 minutos de pipeline por corrida,
resultado no fiable pase lo que pase con el timeout): **`test:e2e` deja de
correr en `.github/workflows/ci.yml`**, con el motivo y las cifras de los
cuatro runs documentadas directamente en el comentario del propio
workflow, no sólo aquí. `npm test` y `test:rules` siguen en la misma tanda
con emuladores; `vmstat` se queda porque también les es útil a esos dos.

**Qué no cambia**: los ficheros de `apps/web/e2e/**` no se tocan ni se
borran — siguen siendo la mejor herramienta para verificación manual local
(`npm run test:e2e`) y para cuando se retome esto. **Qué sí queda
pendiente**, sin fecha: entender la causa real del cuelgue en
`/app/login` bajo el runner (posible candidato: la misma familia que el
bug de producción, nunca probado en las condiciones exactas de CI), o
reducir el número de e2e a favor de más cobertura unitaria — lo segundo
señalado por el usuario aparte, como tarea propia, no resuelta en este
documento.

Los criterios de éxito 2 y 3 de más arriba quedan sin cumplir a propósito:
la petición original («que pasen todos los tests») se sustituye por la
decisión más pragmática de no correrlos en CI hasta que valgan lo que
cuestan. El criterio 4 (el trinquete de reintentos probado en ambos
sentidos) sigue siendo el resultado real y verificado de esta tarea.

## Revisión final: qué queda de todo esto, y por qué

Con `test:e2e` fuera de CI, tocaba repasar qué del resto seguía teniendo un
beneficiario real y qué era ya configuración sin nadie que la aprovechara.
Decidido con el usuario, no en solitario:

- **`retries: 0` y `arch/ci-retries.test.ts` se quedan.** No protegen nada
  en CI ahora mismo —no hay `test:e2e` que pueda esconder un fallo—, pero
  es la disciplina correcta para `npm run test:e2e` en local y para el día
  que esta suite vuelva a CI, y el trinquete no cuesta nada (`test:arch`
  sigue corriendo en la tanda rápida).
- **`vmstat` en `.github/workflows/ci.yml` se queda.** Diagnosticaba
  justo la contención de `test:e2e`, que ya no corre, pero es gratis en
  tiempo de pipeline y sigue cubriendo `npm test` y `test:rules`, que
  comparten el mismo runner de 2 núcleos.
- **`timeout: 60_000` y `expect.timeout: 10_000` se revirtieron.** Sin
  beneficiario: CI no ejecuta `test:e2e` para aprovecharlos, y en local
  todas las corridas de esta investigación pasaron bien con los valores
  por defecto de Playwright (30 s / 5 s). La recomendación de partir de
  60 s/10 s si esta suite vuelve a CI queda en este documento, no en
  configuración activa sin nadie que la ejecute.

## Segunda causa encontrada: una carrera de `@lit/context`, no sólo el SDK de Auth

Meses después, el mismo síntoma en producción —`/app` atascado en "Checking
your session", sin error, sin llamada de red, resuelto a veces con una
recarga— seguía apareciendo con más frecuencia de la que el fix de
persistencia de más arriba explicaba. Instrumentar `onAuthStateChanged` con
`console.log` y `performance.now()` directamente en el código, en vez de
seguir tirando de trazas de red e IndexedDB, mostró algo que contradice el
diagnóstico original: **`onAuthStateChanged` dispara en 1-2 ms, con
`user=null`, en el 100 % de los intentos capturados — incluidos los que el
propio navegador daba por colgados.** El SDK de Auth no era el cuello de
botella; sólo lo parecía porque su resultado nunca llegaba a ningún sitio.

La causa real está en `main.ts`: `firebase-provider.js` y `app-shell.js` se
cargan con `import()` dinámico en paralelo (`Promise.all`), a propósito, para
no añadir un salto de red al camino crítico. Como `<planu-firebase-provider>`
y `<planu-app>` ya existen en el marcado estático de `app.html`, el módulo
que termine de evaluarse primero define su custom element y lo actualiza
**de inmediato**. Si `app-shell.js` gana esa carrera, `<planu-app>` —que
consume `userContext` con `@consume({subscribe: true})`— dispara su
`context-request` antes de que `<planu-firebase-provider>` haya construido
sus `ContextProvider` y enganchado el listener que lo atendería. `@lit/context`
no reintenta una petición que no encontró proveedor: se pierde para siempre,
sin error, y `this.user` se queda en `undefined` de por vida — exactamente
el síntoma observado, y tanto más frecuente cuanto más ha crecido
`firebase-provider.ts` con la migración a arquitectura hexagonal (180 KiB a
fecha de este hallazgo), que desplaza a su favor el resultado de la carrera.

Se descartaron primero dos hipótesis con experimentos controlados antes de
llegar a esta: la propia resolución de Auth (arriba) y el SDK de
Analytics/Installations —una correlación que resultó ser un artefacto de
cerrar el contexto del navegador demasiado pronto en las corridas rápidas,
no una relación causal; repetido el experimento sin cerrar antes de una
ventana fija, la actividad de IndexedDB aparecía igual en éxitos y
cuelgues—.

**Arreglo**: `main.ts` engancha un `ContextRoot` de `@lit/context` a
`document.body` antes de lanzar los dos `import()`. Es el mecanismo que la
propia librería ofrece para "el consumidor se conecta antes que su
proveedor": guarda cualquier `context-request` con `subscribe: true` que no
encontró quien la atendiera y la vuelve a disparar en cuanto un proveedor
que sirve ese contexto se anuncia a través de su evento `context-provider` —
sin reintroducir el `await` secuencial entre los dos módulos que la carga en
paralelo evita a propósito.

**Verificado** con la misma metodología de A/B contra red estrangulada
(150-500 ms por petición) usada en este documento: build con el arreglo, 40
intentos, **0/40 cuelgues** (dos tandas de 20), frente al 65-80 % de cuelgos
observado contra el mismo build sin el `ContextRoot`. `SESSION_CHECK_TIMEOUT_MS`
en `app-shell.ts` se queda como red de seguridad genérica, no porque se
espere que vuelva a saltar por esta causa.

Esto también responde a la pregunta que este documento dejaba abierta más
arriba sobre el cuelgue de `/app/login` bajo el runner de CI: es plausible
que fuera la misma familia de problema, aunque no se ha vuelto a intentar
reproducir específicamente en esas condiciones — `test:e2e` sigue fuera de
CI y esta confirmación no cambia esa decisión por sí sola.
