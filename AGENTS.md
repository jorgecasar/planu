# planu

Planificador de eventos: crear, listar, buscar y filtrar eventos con título,
descripción, ubicación, fechas e imagen. **Los eventos son privados: sólo su
creador los lee y los modifica.**

Si lees en algún sitio que son públicos de lectura, es documentación heredada
del prototipo y está equivocada. La lectura pública fue una fuga real que se
corrigió; ver [`docs/adr/0002-eventos-privados-por-usuario.md`](docs/adr/0002-eventos-privados-por-usuario.md).

Esta es la **segunda implementación** del proyecto. La primera fue un prototipo
generado con Firebase Studio en julio de 2025 (Next.js, React y shadcn/ui),
abandonado el mismo día; se sustituyó por completo por esta reescritura con web
components. Del prototipo se conservan el concepto, el modelo de datos, las
reglas de seguridad —reescritas, ver más abajo— y el proyecto de Firebase
`planu-app`.

La especificación de producto original está en [`docs/blueprint.md`](docs/blueprint.md)
y el modelo de datos en [`docs/backend.json`](docs/backend.json). Ambos vienen
del prototipo y **no han sido revisados todavía** para esta reescritura.

## Stack

Monorepo con npm workspaces (`apps/*`, `packages/*`). Hoy sólo existe
`apps/web`.

| Capa | Elección |
| --- | --- |
| Componentes | Lit 3 (web components) |
| Librería de UI | Web Awesome 3 (`@awesome.me/webawesome`) |
| Build y dev server | Vite 7 |
| Lenguaje | TypeScript 5.9, `@tsconfig/strictest` |
| Tests unitarios | Vitest 4 en modo browser (Playwright/Chromium) |
| Tests e2e | Playwright + axe-core |
| Lint y formato | Biome 2, `lit-analyzer` |
| Backend | Firebase: Auth, Firestore, Storage |
| Despliegue | Firebase Hosting clásico, proyecto `planu-app` |

### Detalles de configuración que no son obvios

1. **Decoradores legacy, no estándar.** `tsconfig.json` usa
   `experimentalDecorators: true` y `useDefineForClassFields: false` porque
   esbuild —que es quien transpila TypeScript dentro de Vite— no implementa los
   decoradores estándar de TC39. Con `useDefineForClassFields: true` el bundle
   falla con `SyntaxError` al importar cualquier componente. Cambiarlo exige
   añadir `vite-plugin-babel` con `@babel/plugin-proposal-decorators`.
2. **La base de Firestore no es la `(default)`: se llama `planu`.** En
   `firebase.json` la clave `firestore` es un array con `"database": "planu"`,
   y el cliente tendrá que usar `getFirestore(app, "planu")`. Sin eso, las
   reglas se despliegan a una base que no existe y el SDK lee de otra vacía.
3. **`complexity/useLiteralKeys` está desactivada en Biome.** Choca de frente
   con `noPropertyAccessFromIndexSignature` de `@tsconfig/strictest`: una exige
   `process.env.CI` y la otra `process.env["CI"]`.
4. **`correctness/noUnusedPrivateClassMembers` también está desactivada.** Da
   falsos positivos con el patrón que usamos para leer los contextos de Lit:

   ```ts
   const { firestore, user } = this;
   if (!firestore || !user) return;   // aquí TypeScript estrecha el tipo
   ```

   La regla no sigue la desestructuración de `this` y da el campo por muerto.
   Su autofix está marcado como seguro y **borraría campos en uso**: aplicarlo
   deja al editor sin guardar ni subir imágenes. El patrón es deliberado —con
   `@tsconfig/strictest`, estrechar sobre variables locales es lo que evita el
   `!` más abajo, porque `this.firestore` pierde el estrechamiento tras el
   primer `await`— y hay 14 campos `@consume` en el proyecto, así que sembrar
   `biome-ignore` en cada uno sería peor.

**Si `npm run lint` sale con 1 sin mostrar ningún hallazgo, reintenta.** Con
`vcs.enabled` Biome consulta git para respetar `.gitignore`, y si el índice está
ocupado —acabas de hacer `git mv`, o hay otra sesión trabajando en un worktree
que comparte el mismo `.git`— falla en silencio con «Checked N files» y ni un
diagnóstico. Es transitorio: a la segunda pasa. Un fallo real siempre imprime
qué regla y en qué fichero.

**Nada de comentarios en `biome.json`.** Aunque el fichero parezca JSONC, un
comentario invalida la configuración **en silencio**: Biome no avisa, cae a sus
valores por defecto y se pone a analizar `dist/` y `node_modules/`. La señal es
un salto repentino a miles de errores. Los motivos van aquí, no ahí.

## Convenciones

### Idioma

- **Documentación, ADRs y comentarios de código: español.** Con acentos y
  diacríticos correctos, sin sustituirlos por ASCII.
- **Mensajes de commit: inglés**, siguiendo [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Lo valida commitlint.
- Los identificadores de código van en inglés.

### Módulos

**ES modules en todo el repo. CommonJS no entra.** Cada `package.json` declara
`"type": "module"` —también los que se añadan a `packages/`—, de modo que un
`.js` ya *es* un módulo y **no se usan las extensiones `.mjs` ni `.cjs`**: no
aportan nada y delatan que el paquete no está bien configurado.

Al importar un paquete de terceros que aún distribuya ambos formatos, coge su
entrada ESM (`exports["."].import`). La de CommonJS obliga a rodeos del tipo
`mod.default ?? mod`, y en el caso de Sentry además impedía el tree-shaking:
importar el espacio de nombres completo dejaba 162 KiB de Session Replay en el
bundle.

### Capas, y la regla que las mantiene separadas

La migración a arquitectura hexagonal está en marcha —ver
[`docs/spec-arquitectura-hexagonal.md`](docs/spec-arquitectura-hexagonal.md)—.
El objetivo es **testabilidad**: poder probar la lógica sin levantar emuladores.
No es portabilidad; Firebase se queda.

| Capa | Qué vive ahí | Puede importar |
| --- | --- | --- |
| `src/domain/` | Modelo y reglas de negocio | nada externo salvo `@lit/localize` |
| `src/application/` | Casos de uso y sus puertos | `domain/` |
| `src/infrastructure/` | Adaptadores. **El único sitio con `firebase/*`** | `domain/`, puertos |
| `src/ui/` | Componentes Lit | `application/` |

Hoy sólo existe `domain/`; las demás las crean T36, T37 y T38, cada una con su
puerto. El resto del código sigue organizado por funcionalidad y **está en
migración**.

**La regla, y no es opcional: toda tarea que toque un componente acoplado lo
deja tras su puerto antes de darse por hecha.** Es lo que hace incremental la
migración en vez de dejar dos estilos conviviendo para siempre. Saltársela tiene
precedente y coste medido: `sharing/` nació con Firebase dentro mientras se
redactaba la especificación, y los ficheros acoplados pasaron de 16 a 20 en unas
horas.

Lo vigilan dos cosas, no la buena voluntad:

1. **`biome.json` prohíbe `firebase/**` en todo `apps/web/src/**`**, con una
   lista de exenciones heredadas que **sólo puede encoger**. Añadir una entrada
   es un cambio visible en la revisión; olvidarse de migrar, no.
2. **`npm run test:arch`** vigila esa configuración con siete aserciones. Corre
   en Node, sin emuladores, junto a la calidad estática.

**La métrica de progreso son los ficheros acoplados, no las entradas de la
lista.** Hoy son **23 ficheros** cubiertos por 18 entradas, porque
`firebase/**` agrupa seis. El tope está fijado en `arch/boundary.test.ts` y
cada migración lo baja; subirlo hace fallar la suite.

Y el vigilante vigila **la puerta además de la lista**: comprueba que siga
existiendo exactamente un `override` que impone la regla y otro que exime, y que
el que impone cubra todo `src/**` y el paquete `firebase` entero. Sin eso,
borrar el primero dejaba las aserciones en verde y el lint limpio — lo encontró
una revisión, no el test.

El segundo existe porque el primero no se vigila solo: un comodín `sharing/**`
llegó a eximir tres ficheros que no importaban Firebase, uno de ellos un módulo
de política sin dependencias, y sólo lo detectó una revisión.

### Dónde va cada cosa

| Qué | Dónde |
| --- | --- |
| Aplicación web | `apps/web/src/` |
| Tests unitarios | junto al fuente, `*.test.ts` |
| Tests e2e | `apps/web/e2e/` |
| Paquetes compartidos | `packages/` (vacío por ahora) |
| Documentación general | `docs/` |
| Decisiones arquitectónicas | `docs/adr/` |
| Plan de trabajo vigente | `tasks/plan.md` |
| Lista de tareas | `tasks/todo.md` |
| Reglas de seguridad | `firestore.rules`, `storage.rules` (raíz) |

Los ADRs se numeran (`0001-titulo-en-kebab-case.md`) y no se reescriben una vez
aceptados: si una decisión cambia, se añade un ADR nuevo que la supersede.

### El plan también se actualiza, no sólo la lista de tareas

`tasks/todo.md` lleva las casillas de cada tarea; `tasks/plan.md` lleva las de
cada **checkpoint**, que es lo que decide si una fase se cierra. Durante meses
sólo se marcó lo primero, y el resultado fue que **las veintiséis casillas de
checkpoint seguían vacías con las fases 6, 7 y 10 terminadas** — incluida una
que hoy es **falsa a sabiendas** y nadie había registrado.

Por eso:

- **La tarea que cierra una fase evalúa su checkpoint en el mismo commit.** Las
  demás tareas de la fase dejan su evidencia en su entrada de `todo.md` y no
  tocan `plan.md`: varias ramas escribiendo en las mismas líneas garantizan
  conflicto, y ninguna puede cerrar sola un checkpoint que depende de sus
  hermanas.
- **Una casilla se marca sólo con la evidencia al lado**: el comando y su
  código de salida, o el fichero y la línea.
- **Lo que no se puede demostrar no se marca.** Se deja sin marcar diciendo qué
  falta y de quién depende. Hay tres clases que nunca las cierra un agente: la
  revisión humana de las reglas, abrir un `.ics` en una aplicación real, y todo
  lo que viva en `firebase.json` —redirecciones, CSP, cabeceras— porque los e2e
  corren contra `npm run dev` y no ven esa configuración.
- **Un ítem que quedó obsoleto se tacha, no se borra.** Si se borra, se pierde
  que el plan es anterior a la decisión que lo invalidó.

### Ramas: `git branch --merged` miente aquí

Las PR entran con **squash**, así que el commit que aterriza en `main` tiene un
SHA distinto del de la rama. Git no puede deducir por ascendencia que está
fusionada, y `--merged` la da por viva aunque su contenido esté dentro entero.

Lo que sí funciona es comparar contenido:

```bash
git diff origin/main origin/<rama> --name-only    # vacío = ya está en main
```

Y aplasta **antes** de abrir la PR: es la convención de este repo, y así el
mensaje del commit lo escribe quien conoce el cambio, no el formulario de
GitHub.

## Comandos

```bash
npm run setup       # instala dependencias y restaura las skills del agente
npm run dev         # servidor de desarrollo en http://localhost:3000
npm run build       # typecheck + build de producción a apps/web/dist
npm run build:landing  # landing prerrenderizada + app, a dist/ (lo que se publica)
npm test            # tests unitarios (Vitest en Chromium real)
npm run test:e2e    # tests e2e con Playwright y axe, contra `npm run dev`
npm run test:e2e:landing  # e2e de la landing, contra dist/ (exige build:landing)
npm run lint        # Biome: formato y lint
npm run lint:fix    # Biome con autoarreglo
npm run lint:lit    # lit-analyzer sobre las plantillas
npm run typecheck   # tsc --noEmit
npm run emulators   # emuladores de Firebase (auth, firestore, storage)
```

`npm test` y los dos `test:e2e*` necesitan el navegador de Playwright:
`npx playwright install chromium`.

**La landing no existe en `npm run dev`.** La genera `build:landing` con
`@lit-labs/ssr` y sale a `dist/`, así que sus e2e tienen configuración propia
—`playwright.landing.config.ts`— que levanta `scripts/serve-dist.js` sobre ese
directorio. Probarla contra el servidor de desarrollo comprobaría una página que
no es la que se publica, que es la definición de test vacuo de este repo.

Ese servidor **no hace fallback a `index.html` a propósito**: la landing es
multipágina y un fallback haría responder 200 a cualquier ruta inexistente,
incluidas las tres que el `hreflang` promete —y comprobar que existen es justo
uno de los tests.

**Lo que se publica es `dist/`, no `apps/web/dist`.** El `predeploy` de
`firebase.json` corre `build:landing`, que construye la aplicación y luego copia
su salida junto a la landing. Si `public` volviera a apuntar a `apps/web/dist`,
se desplegaría la aplicación sin la portada.

`npm run emulators` necesita **Java 21 o superior en el PATH**. `firebase-tools`
15 rechaza cualquier versión anterior y aborta con «no longer supports Java
version before 21», sin llegar a levantar nada.

Homebrew instala `openjdk` como *keg-only*, así que no basta con
`brew install openjdk`; hay que añadirlo:

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # en ~/.zshrc
```

`npm run emulators` **conserva los datos entre reinicios**: exporta a
`.emulator-data/` al salir e importa de ahí al arrancar. Sin eso, cada reinicio
se llevaba las cuentas y había que volver a registrarse; el síntoma era un
«no me autentica» que no explicaba nada, porque la cuenta simplemente había
dejado de existir.

Dos límites que conviene conocer antes de extrañarse:

1. **Sólo exporta si los emuladores salen limpiamente.** Ctrl-C sí; `kill -9`
   no.
2. **La exportación de Firestore sólo cubre la base `(default)`, y la de este
   proyecto se llama `planu`.** Comprobado escribiendo un documento en cada una:
   tras reiniciar sobrevive el de `(default)` y desaparece el de `planu`. Es
   decir, **las cuentas sobreviven y los eventos no**.

Para volver a poner datos con los que probar a mano:

```bash
npm run seed                        # cuenta de ejemplo y once eventos
npm run seed -- otra@example.com    # o la cuenta que quieras
```

Siembra **escribiendo como el usuario**, no con el acceso de administración: si
algo no pasa `firestore.rules`, es mejor enterarse ahí que en la interfaz. Y las
fechas son relativas a hoy, porque el listado separa próximos de pasados por el
instante actual y un dato fijo dejaría de enseñar lo que viene a enseñar.

Los puertos no son los de por defecto: Firestore usa el **8181** y Hosting el
**5050**, porque en macOS el 5000 lo ocupa el receptor AirPlay del sistema y el
8080 suele estar cogido. Están en `firebase.json` y replicados en
`src/firebase/config.ts`; si cambias uno, cambia el otro.

Las variables de entorno viven en `.env.local` **en la raíz del monorepo**, no
en `apps/web`. Por eso `vite.config.ts` fija `envDir`: sin ello Vite las busca
junto a sí mismo y la aplicación arranca con `auth/invalid-api-key`.

## Soporte de navegador

Por defecto, **Baseline widely available** sin fallback. Todo lo que no lo sea
va detrás de detección de disponibilidad y degrada a una ruta que sí funcione
en cualquier navegador moderno.

Hoy la única excepción es la IA integrada, y la resuelve el SDK de Firebase AI
Logic. Sin ella y sin derecho a la nube, el aviso remite al alta manual.

## Idiomas

**Todo texto visible va envuelto en `msg()` de `@lit/localize`.** Ninguna cadena
de interfaz se escribe suelta en una plantilla.

El idioma sale del navegador: se elige el primero de `navigator.languages` que
sepamos servir, ignorando la región (`es-AR` se sirve como `es`), y si no encaja
ninguno se usa inglés. La lógica está en `src/domain/pick-locale.ts`, aislada y
con tests.

Se fija **antes del primer render** en `src/main.ts`. Pintar y cambiar después
haría saltar la interfaz de inglés al idioma del usuario a la vista.

Al añadir o cambiar un texto:

```bash
npm run localize:extract   # actualiza xliff/es.xlf
# traducir los <target> nuevos
npm run localize:build     # regenera src/generated/locales/
```

Los mensajes que viven fuera de un componente —esquemas de Zod, mapas de
errores— se construyen en **fábricas**, no en constantes de módulo: `msg()` se
evalúa al llamarlo, y un valor creado al importar congelaría el idioma de ese
instante.

## Coste de la IA

La inferencia en el dispositivo es gratis; la de la nube factura por token, así
que **está cerrada por defecto**. Se abre sólo si se cumplen las dos:
`VITE_AI_CLOUD_FALLBACK=true` en el despliegue **y** el claim `premium` en el
token del usuario. La lógica está en `src/domain/ai-policy.ts`, aislada y con
tests; no la dupliques en los componentes.

Para saber dónde se resolvió una generación, mira
`response.inferenceSource`: el modo es una preferencia, no una garantía.

## Despliegue

**Un push a `main` que pase la verificación despliega.** Hosting, reglas e
índices, en un solo `firebase deploy`. Todo vive en
`.github/workflows/ci.yml`; el porqué, en
[`docs/adr/0004`](docs/adr/0004-despliegue-continuo.md).

**No hay entornos ni canales de preview**, y es deliberado: no hay usuarios
reales, así que no existe el dato que un entorno de preproducción viene a
proteger. Se llegó a montar y se deshizo; el motivo y lo que habrá que hacer al
lanzar están en [`docs/adr/0005`](docs/adr/0005-sin-entornos-de-preview.md).
La consecuencia a tener presente es que **la CSP y las cabeceras de caché no las
prueba nadie automáticamente**: los e2e corren contra `npm run dev` y nunca ven
la configuración de hosting. Se comprueban a mano tras desplegar.

Tres cosas que no son obvias y que conviene no deshacer:

1. **El build del despliegue sale del `predeploy` de `firebase.json`**, nunca de
   un paso propio del workflow. Si el job construyera por su cuenta, el
   predeploy volvería a construir encima y se publicaría un bundle distinto de
   aquel cuyos debug IDs se subieron a Sentry: maps huérfanos, trazas
   minificadas, y ni un solo error visible. Ese predeploy es hoy
   **`npm run build:landing`**, que construye la aplicación *y* prerrenderiza la
   portada; `npm run build` a secas dejaría `dist/` sin landing.
2. **La subida de source maps la gobierna `SENTRY_UPLOAD=true`**, que sólo pone
   el job de producción — no la presencia de `SENTRY_AUTH_TOKEN`. Con el gate
   por token, exportarlo en el `.zshrc` convertiría cada build local en una
   release. Si el interruptor está puesto y falta alguna variable, el build
   **para**: ver `apps/web/vite.config.ts`.
3. **El job `deploy` tiene grupo de concurrencia propio, sin
   `cancel-in-progress`.** El grupo general cancela lo anterior en cada push, y
   eso a mitad de un `firebase deploy` deja producción sin revisar.

### Si el paso de emuladores de CI se queda colgado

No lo depures: reintenta. El optimizador de dependencias de Vite falla de vez
en cuando al crear su directorio temporal y **entra en un bucle de reintentos
sin salida**, de modo que el job no tiene en qué fallar. La señal es exacta:

```
Error: ENOENT: no such file or directory, mkdir
  '.../apps/web/node_modules/.vite/vitest/<hash>/deps_temp_XXXXXXXX'
[vite] (client) error while updating dependencies
```

y después nada más, durante horas. Suelen aparecer **dos** errores seguidos con
temporales distintos: es una carrera entre dos optimizadores.

No lo provoca el contenido de la rama. Se comprobó aislando los dos únicos
cambios que compartían las dos ramas afectadas —tocar `apps/web/vite.config.ts`
y añadir un prefijo `TZ=` al script `test`— y **cada uno por separado pasa**, y
juntos también. El job lleva `timeout-minutes` para que esto falle en veinte
minutos en vez de consumir el tope de seis horas.

## Rendimiento

Línea base medida en agosto de 2026 contra producción, móvil: la página de
acceso pesa **156 KiB** y no contacta con ningún origen ajeno salvo los de
configuración de Firebase.

Dos comprobaciones que **no están en la suite de tests, y no pueden estarlo**:

```bash
node scripts/check-startup-cost.js [url]   # orígenes y peso al arrancar
node scripts/verify-sentry.js [url]        # que un error llega con debug IDs
```

Ambas exigen un bundle construido hablando con Firebase de verdad, así que van
contra producción o contra un canal de preview, nunca contra `npm run dev`.
Se intentó la primera como e2e y **salió vacua**: en desarrollo
`connectAuthEmulator` evita que Firebase cargue gapi, de modo que la condición
se cumplía sola y no detectaba la regresión que venía a impedir. Un test que no
puede fallar es peor que ninguno.

**Al comparar medidas de Lighthouse, usa la mediana de al menos 5 pasadas.** Con
n = 1 este proyecto da entre 93 y 98 de puntuación, con el Speed Index oscilando
entre 1,7 y 4,2 s y el LCP entre 1,4 y 3,2 s: una sola pasada puede «demostrar»
cualquier cosa. Lo que sí es determinista son los recuentos —peso total, JS sin
usar, orígenes contactados—, y es sobre ellos donde conviene apoyar cualquier
afirmación de mejora.

## Estado de seguridad

`firestore.rules` se reescribió al portarlo. El original de planu tenía dos
fallos que **no deben reintroducirse**:

- Las reglas de Firestore se combinan con **OR**. Separar la validación de
  campos en su propio `allow create, update` anulaba el control de propiedad en
  lugar de sumarse a él: cualquiera, sin autenticar, podía modificar cualquier
  evento. Regla vigente: **un único `allow` por operación**.
- El control de propiedad comparaba contra `resource.data.userId`, un campo que
  el modelo de datos no definía. `userId` es ahora obligatorio y se fija al uid
  de quien crea.

Y uno más en `storage.rules`, **ya resuelto**: el prototipo subía a
`events/{uid}/` pero sus reglas sólo permitían escribir en
`event-images/{imageId}`, así que la subida nunca llegó a funcionar. La ruta
vigente es `events/{userId}/{fileName}`, que además es la única que permite
comprobar propiedad.

### Verificado, no supuesto

Un red-team contra los emuladores probó 10 ataques a Firestore y 6 a Storage:
leer un documento ajeno, listar la colección entera, suplantar `userId`, robar
la propiedad en un `update`, escribir en la carpeta de otro, subir 6 MB y
salirse del prefijo `events/`. Todos bloqueados.

Lo que **no** protegen las reglas, y conviene saber antes de prometer nada:

- La URL que devuelve `getDownloadURL()` lleva un token portador. Quien la
  tenga accede a la imagen sin sesión. El texto del evento sí está protegido;
  la imagen sólo por lo impredecible del token.
- `contentType` lo declara el cliente y no se contrasta con los bytes. Se puede
  subir cualquier cosa etiquetada como `image/png`.

## Toolchain de agente

Este repo trae configuración de agente versionada. Si acabas de clonar, ejecuta
`npm run setup` antes que nada.

### Skills

Se declaran en `skills-lock.json` (versionado); sus cuerpos **no** se versionan.
`npm run setup` los restaura en `.agents/skills/` y los enlaza con symlinks
relativos en `.claude/skills/`. Son 40, de cuatro orígenes:

- `addyosmani/agent-skills` — 24 skills del ciclo de desarrollo.
- `firebase/skills` — 12 skills de Firebase.
- `anthropics/skills` — `frontend-design`.
- `GoogleChrome/modern-web-guidance` — `modern-web-guidance`.
- **Web Awesome** — `webawesome` y `webawesome-design`, que viajan dentro del
  propio paquete npm (`sourceType: local` en el lock, apuntando a
  `node_modules/@awesome.me/webawesome/dist/skills/`). Por eso `setup` ejecuta
  `npm install` **antes** que `setup-skills.mjs`: sin `node_modules` no hay nada
  que enlazar. `npm update` las mantiene al día solas.

Para añadir una skill de GitHub:

```bash
npx -y skills add <owner>/<repo> --skill <nombre> --agent claude-code -y
```

Instalamos sólo para `claude-code`. Si algún día se usa otro agente, se repite
el mismo `skills add` añadiéndolo a `--agent`: el lock no cambia.

### Servidores MCP

- **serena** — navegación de código por LSP (`typescript`). Config en
  `.serena/project.yml`; reindexa con `serena project index`.
- **chrome-devtools** — DOM, consola, red y rendimiento reales. Es lo que hace
  utilizable la skill `browser-testing-with-devtools`.

Están registrados con scope local, fuera del repo: un clon nuevo debe volver a
registrarlos (ver `CLAUDE.md`).

### Búsqueda semántica (qmd)

**No está montada.** `docs/` sólo tiene los dos ficheros heredados de planu, que
no son corpus suficiente. Merece la pena montarla cuando haya ADRs y
especificaciones; `scripts/setup-skills.js` ya contempla el reindexado si
aparece `.qmd/index.yml`.

## Cómo trabajar aquí

### El ciclo de vida es obligatorio

Todo desarrollo sigue las seis fases de
[skills.addy.ie/lifecycle](https://skills.addy.ie/lifecycle/), una por comando,
**en orden**:

| Fase | Comando | Principio |
| --- | --- | --- |
| Definir | `/spec` | Especificación antes que código |
| Planificar | `/plan` | Tareas pequeñas, atómicas, ordenadas |
| Construir | `/build` | Una rodaja fina cada vez: implementar, probar, verificar, commitear |
| Verificar | `/test` | Los tests son la prueba, con evidencia de ejecución real |
| Revisar | `/review` | Puerta de calidad, seguridad y rendimiento antes de fusionar |
| Publicar | `/ship` | Despliegue con reversión y observación |

Más `/webperf` —medir antes de optimizar— y `/code-simplify`.

**Saltarse `/spec` y `/plan` es el error caro.** En agosto de 2026 se
construyeron entornos de preview por PR sin ninguna de las dos: canales de
hosting, autorización dinámica de dominios OAuth, un rol de IAM, una base de
Firestore y un bucket. Se desmontó entero horas después porque la pregunta que
`/spec` habría hecho —*¿qué dato protege esto hoy?*— tenía como respuesta
«ninguno, no hay usuarios». Ver [`docs/adr/0005`](docs/adr/0005-sin-entornos-de-preview.md).

### Trabajar en loops, con la autonomía justa

Según [skills.addy.ie/loops](https://skills.addy.ie/loops/), la regla que manda
es: **concede a un loop tanta autonomía como puedas verificar barata y
fiablemente, y ni un dedo más.**

- **Maker ≠ checker.** Quien escribe no juzga: un modelo se aprueba a sí mismo
  con demasiada facilidad. Aquí eso significa subagentes distintos —`/review` y
  `/ship` ya lanzan `code-reviewer`, `security-auditor` y `test-engineer`.
- **Loops cortos**, de tres a diez pasos, para que un error no se esconda.
- **Luces encendidas** —con persona delante— en seguridad, reglas de Firestore,
  migraciones, facturación y cualquier cosa de radio de impacto grande.
- **Luces apagadas** sólo cuando la comprobación es un oráculo binario y difícil
  de falsear: la suite de tests, axe, un umbral de Core Web Vitals.

### Verificar de verdad

1. **Comprueba el código de salida, no la salida.** Leer «Tests passed» en un
   texto no es verificar. En esta sesión se reportó el pipeline en verde tres
   veces estando en rojo por leer la salida en lugar de `$?`, y se publicó un
   commit con `lint` en 1 por imprimir el código sin usarlo como puerta.
2. **Un test que no puede fallar es peor que ninguno.** Antes de dar uno por
   bueno, rómpelo a propósito y comprueba que lo detecta. Dos e2e que defendían
   un ahorro de 137 KiB pasaban igual con la regresión puesta: en desarrollo la
   condición se cumplía sola.
3. **Nunca `biome check --write` a ciegas.** Hay autofixes marcados como seguros
   que borran código en uso; ver el punto 4 de la configuración.

### Y además

- **Antes de escribir código**, comprueba si aplica alguna skill. Para UI, las
  de Web Awesome son la referencia de componentes y de diseño.
- **Las decisiones se documentan** en `docs/adr/`. Un ADR aceptado no se
  reescribe: si cambia, se añade otro que lo supersede.
- **No toques `.agents/skills/` ni `.claude/skills/` a mano**: son contenido de
  terceros y se regeneran. Lo que manda es `skills-lock.json`.
- **La accesibilidad no es opcional**: el e2e falla si axe detecta violaciones.

## Decisiones pendientes

- Revisar `docs/blueprint.md` para la reescritura: sigue describiendo la app de
  planu, con guías de estilo (indigo #3F51B5, tipografías Belleza y Alegreya)
  que hay que traducir a tokens de Web Awesome o descartar.
- El generador de eventos con IA (Genkit sobre Next en planu) está **aplazado**.
  Al retomarlo hay que elegir entre Cloud Functions con Genkit o `@google/genai`
  directamente, y escribir el ADR correspondiente.
- Convención de nombres para las imágenes en Storage (ver arriba).
- **Arquitectura hexagonal.** Hoy el código se organiza por funcionalidad
  (`auth/`, `events/`, `firebase/`…) y no por capas, y las dependencias de
  terceros se importan allí donde se usan. La dirección acordada es aislarlas
  tras puertos, con los adaptadores en una capa de infraestructura. Sentry
  (`src/observability/`) es el caso más fácil, pero **el que de verdad importa
  es Firebase**: hoy `Firestore`, `User` y `FirebaseStorage` entran por
  `@consume` directamente en los componentes de eventos, así que el dominio
  conoce al proveedor. Hacerlo sólo en observabilidad dejaría el proyecto a
  medio camino, así que conviene decidir el alcance completo y escribir el ADR
  antes de mover nada.
