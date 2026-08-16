# Tareas — fase 2

Derivadas de [`plan.md`](plan.md). Orden por dependencia, no por importancia.
Las tareas de la fase 1, completadas, están en [`fase-1/todo.md`](fase-1/todo.md).

Numeración continuada: la fase 1 llegó hasta T10.

## Fase 5 — Precondiciones y decisiones

- [x] **T11 · Java, emuladores y hosting local** · XS · sin dependencias
  - Acepta: `java -version` responde; `npm run emulators` arranca auth,
    firestore, storage **y hosting**; `npm run test:rules` pasa con los tests
    que ya existen.
  - Verifica: `npm run test:rules` → **19/19 en verde**
  - Resultado: no hizo falta instalar nada. `openjdk` ya estaba en Homebrew,
    sólo es *keg-only* y le faltaba el PATH. `firebase.json` ya declara el
    emulador de hosting en el 5050 y `npm run emulators` los arranca todos.
    Pendiente **del usuario**, fuera del repo:
    `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"` en `~/.zshrc`.

- [x] **T12 · ADR 0006 y 0005, y la decisión de «salir de un evento»** · S · sin dependencias
  - Acepta: ADR 0006 registra la compartición por invitados con rol y que
    supersede parcialmente al 0002; ADR 0007 registra por qué el directorio de
    usuarios vive en el cliente y no en Cloud Functions; **ambos dejan escrito
    si un usuario puede quitarse a sí mismo de `memberIds`**, porque T13 depende
    de ello.
  - Verifica: revisión humana; coherencia con `docs/spec-fase-2.md`
  - Ficheros: `docs/adr/0004-*.md`, `docs/adr/0005-*.md`, `docs/adr/0002-*.md`
  - Resultado: **decidido que sí** — un usuario puede quitarse a sí mismo y sólo
    a sí mismo; el dueño no puede irse del suyo. Antes de decidirlo se sondeó el
    emulador para confirmar que el lenguaje de reglas puede expresarlo:
    `List.removeAll()`, `Map.diff().affectedKeys()` y `hashing.sha256()`
    existen y funcionan. Eso cierra además dos preguntas abiertas del spec.

## Fase 6 — Modelo de datos y reglas

- [x] **T13 · Esquema y reglas de compartición** · M · depende de T11, T12
  - Acepta: el esquema Zod gana `memberIds`, `roles`, `tags` y `createdAt`; las
    reglas incorporan `isMember`, `isEditor` y `membershipUnchanged`, con **una
    única regla `allow` por operación** y un tope de invitados por evento.
  - Verifica: `npm run test:rules` con los casos que **deniegan** escritos
    antes que la regla — editor que se asciende, editor que se queda la
    propiedad, extraño que lee, usuario que se autoañade.
  - Ficheros: `firestore.rules`, `apps/web/rules/firestore.test.ts`,
    `apps/web/src/lib/types.ts`

- [x] **T14 · Membresía al crear y consulta por membresía** · M · depende de T13
  - Acepta: el editor crea con `memberIds: [uid]` y `roles: {}`; el listado pasa
    de `where('userId','==',uid)` a `array-contains`.
  - Verifica: **25/25 e2e en verde**, sin regresiones.
  - Ficheros: `src/events/event-editor.ts`, `src/events/events-view.ts`
  - Resultado y dos desviaciones del plan:
    1. **No hace falta índice compuesto.** La consulta no lleva `orderBy`, y
       `array-contains` a secas se resuelve con el índice automático de un solo
       campo. `firestore.indexes.json` se queda como está. Cuando T19 añada
       ordenación, ahí sí hará falta.
    2. **Al editar ya no se reenvía el `userId`.** Antes se fijaba siempre al
       uid de la sesión; con invitados eso le costaría el permiso a un editor,
       porque para las reglas equivale a transferirse la propiedad. Ahora sólo
       viaja el contenido, y la propiedad y la membresía sólo se fijan al crear.
  - **Backfill: no entregado, y es deliberado.** Requiere `firebase-admin`
    (dependencia nueva, cae en «preguntar primero») y, antes de eso, saber si la
    base `planu` tiene documentos heredados — la pregunta abierta nº 1 del
    `SPEC.md`, que sigue sin comprobarse. Sin ese dato no se puede decidir entre
    migrar o descartar. **Bloquea el despliegue, no el desarrollo.**

> **Checkpoint A** — la aplicación hace exactamente lo mismo que antes, con el
> modelo nuevo. Aburrido a propósito: es como se sabe que nada se rompió antes
> de construir encima. Revisión humana de `firestore.rules`.

## Fase 7 — Compartir

- [x] **T15 · Directorio de usuarios (F1)** · M · depende de T13
  - Acepta: `userDirectory/{sha256(email)}` con `uid`, `displayName` y
    `photoURL`; se escribe al autenticarse; las reglas permiten `get` pero **no
    `list`**, exigen `hasOnly` de esos tres campos y atan el documento al email
    del token.
  - Verifica: **lo primero, confirmar en el emulador que
    `hashing.sha256().toHexString()` existe en reglas de Firestore**; si no,
    aplicar el plan B del spec. Después, test de reglas del intento de escribir
    en el hash de otra persona, y unitario del hash.
  - Ficheros: `src/sharing/user-directory.ts` + test, `firestore.rules`,
    `apps/web/rules/firestore.test.ts`, `src/firebase/firebase-provider.ts`

- [x] **T16 · Diálogo de compartir (F2)** · M · depende de T15
  - Acepta: `roleFor`, `canEdit` y `canShare` como funciones puras; diálogo para
    invitar por email, cambiar rol y expulsar; mensaje claro y enlace de registro
    cuando el email no tiene cuenta.
  - Verifica: unitarios de permisos; e2e con dos sesiones contra el emulador
  - Ficheros: `src/sharing/permissions.ts` + test, `src/sharing/share-dialog.ts`,
    `src/events/event-card.ts`

- [x] **T17 · Bandeja «compartidos conmigo» (F3)** · M · depende de T16
  - Acepta: conmutador entre todos, míos y compartidos; cada tarjeta compartida
    dice de quién es y con qué rol; a un lector no se le ofrecen editar ni
    borrar.
  - Verifica: e2e con dos sesiones y axe
  - Ficheros: `src/events/events-view.ts`, `src/events/event-card.ts`,
    `src/events/event-filters.ts`

> **Checkpoint B** — dos usuarios reales con permisos distintos, verificados por
> las reglas y no por la interfaz.

## Fase 8 — Organización

- [ ] **T18 · Etiquetas (F6)** · M · depende de T13
  - Acepta: de cero a diez etiquetas, normalizadas (recortadas, en minúsculas,
    sin duplicados, máximo 24 caracteres); autocompletado con las ya usadas;
    filtro que combina varias con **Y**; color estable derivado del nombre.
  - Verifica: unitarios de normalización y de filtrado combinado
  - Ficheros: `src/events/tags.ts` + test, `src/events/event-editor.ts`,
    `src/events/filter-events.ts`, `src/events/event-filters.ts`

- [ ] **T19 · Orden y agrupación (F7)** · S · depende de T13
  - Acepta: orden por fecha de inicio, título o creación; separación entre
    próximos y pasados con los pasados plegados; los eventos sin fecha en su
    propio grupo, con la misma semántica que ya usa `filterEvents`; preferencia
    recordada.
  - Verifica: unitarios de ordenación con empates y eventos sin fecha
  - Ficheros: `src/events/sort-events.ts` + test, `src/lib/view-preferences.ts`,
    `src/events/events-view.ts`

- [ ] **T20 · Rejilla mensual (F5, primera mitad)** · M · depende de T19
  - Acepta: reparto de eventos en las celdas del mes como función pura; rejilla
    con CSS grid e `Intl.DateTimeFormat`, **sin librería de calendario**; primer
    día de la semana y nombres de mes según el locale; navegable con teclado,
    con `role="grid"` y celdas etiquetadas con la fecha completa.
  - Verifica: unitarios del reparto, incluidos el evento que cruza varios días y
    el cambio de horario de verano; axe sobre la vista
  - Ficheros: `src/calendar/month-grid.ts` + test, `src/calendar/calendar-view.ts`

- [ ] **T21 · Agenda y conmutador de vista (F5, segunda mitad)** · M · depende de T20
  - Acepta: lista cronológica agrupada por día; conmutador entre rejilla,
    calendario y agenda; la vista elegida sobrevive a la recarga; los filtros se
    aplican en las tres.
  - Verifica: e2e con axe en cada una de las tres vistas
  - Ficheros: `src/calendar/agenda-view.ts`, `src/events/events-view.ts`,
    `src/lib/view-preferences.ts`

- [ ] **T22 · Export a calendario (F4)** · M · depende de T13
  - Acepta: `.ics` por evento y de la agenda completa según los filtros activos;
    RFC 5545 en lo que importa (`UID` estable, `DTSTAMP`, escape de comas y
    saltos de línea, plegado a 75 octetos, `VALUE=DATE` para días completos);
    enlace a Google Calendar; un evento sin fechas avisa en vez de generar un
    fichero roto. Todo en cliente, sin dependencias.
  - Verifica: unitarios de `buildIcs` con título con comas, descripción
    multilínea, día completo y línea que obliga a plegar; e2e de la descarga
  - Ficheros: `src/calendar/build-ics.ts` + test,
    `src/calendar/google-calendar-url.ts`, `src/events/event-card.ts`

> **Checkpoint C** — sesenta eventos se navegan por mes, etiqueta y orden; un
> `.ics` real se abre en Calendario de macOS y en Google Calendar.

## Fase 9 — IA

- [ ] **T23 · Crear evento desde texto pegado (F8)** · M · depende de T13
  - Acepta: campo para pegar texto suelto junto al generador desde imagen;
    **reutiliza `ai-policy.ts` y el mismo `responseSchema`**, sin duplicar la
    decisión de nube; el resultado prerrellena el editor y el usuario confirma;
    tope de longitud del texto; un fallo nunca bloquea el alta manual.
  - Verifica: unitarios con el modelo simulado — éxito, error, IA no disponible,
    texto sin ningún evento
  - Ficheros: `src/events/generate-from-text.ts` + test,
    `src/events/ai-event-generator.ts`

- [ ] **T24 · Sugerencia de etiquetas (F9)** · S · depende de T18, T23
  - Acepta: hasta tres etiquetas propuestas al guardar un evento sin ellas,
    priorizando las que el usuario ya usa; aparecen desmarcadas y nunca se
    aplican solas; si la IA no está disponible, silencio y ningún error.
  - Verifica: unitarios con el modelo simulado, incluido que devuelva etiquetas
    que incumplen la normalización de T18
  - Ficheros: `src/events/suggest-tags.ts` + test, `src/events/event-editor.ts`

> **Checkpoint D** — las dos rutas nuevas de IA funcionan con el modelo simulado
> y su fallo no rompe nada.

## Fase 10 — Producto: cimientos

- [x] **T25 · Mudanza de la aplicación a `/app` (F10)** · M · sin dependencias
  - Acepta: `index.html` pasa a `app.html` y sigue siendo la única entrada de
    Vite; todas las rutas cuelgan de `/app`; `guardRedirect` apunta a
    `/app/login`; los rewrites dejan de mandar `**` a `/index.html` y pasan a
    `/app/**` → `/app.html`; redirecciones permanentes desde las rutas antiguas.
  - Verifica: **todos los e2e existentes pasan con las rutas nuevas**; rewrites
    y redirecciones probados contra el emulador de Hosting; despliegue a un canal
    de previsualización antes de tocar producción.
  - Ficheros: `apps/web/app.html`, `src/app-shell.ts`, `src/auth/guard.ts`,
    `firebase.json`, `apps/web/e2e/*.spec.ts`
  - Nota: **va sola y con su propio commit.** Toca enrutado, guarda de sesión y
    despliegue a la vez; mezclarla con otra cosa hace imposible saber qué rompió
    qué. Un error aquí deja la aplicación inaccesible.

> **Checkpoint E** — el más delicado de todo el plan. La aplicación vive en
> `/app` y se despliega sin romper nada.

## Fase 11 — Producto: la cara

- [ ] **T26 · Decidir la identidad visual (F12, decisión)** · S · sin dependencias
  - Acepta: ADR 0008 que resuelve si se adopta el indigo `#3F51B5` con Belleza y
    Alegreya del blueprint, se ajusta o se descarta. **Cualquiera de las tres es
    válida; seguir sin decidir no lo es.** Incluye la tabla de contraste AA
    verificada, no supuesta.
  - Verifica: revisión humana; contraste comprobado
  - Ficheros: `docs/adr/0008-*.md`, `docs/blueprint.md`

- [ ] **T27 · Tokens de tema y tipografías (F12, implementación)** · M · depende de T26
  - Acepta: la decisión traducida a tokens `--wa-*` en una hoja única compartida
    por landing y aplicación; sin colores sueltos en componentes; modo claro y
    oscuro con `prefers-color-scheme`; **tipografías servidas desde el propio
    dominio**, subconjunto latino y `font-display: swap`; logotipo, favicon y
    `og:image`.
  - Verifica: axe cubre el contraste en los e2e; la aplicación adopta el tema
    sin regresiones visuales
  - Ficheros: `src/styles/theme.css`, `public/fonts/`, `src/main.ts`,
    `apps/web/app.html`

- [ ] **T28 · Pipeline de prerender (F11, primera mitad)** · M · depende de T25
  - Acepta: `scripts/build-landing.mjs` renderiza plantillas `lit-html` con
    `@lit-labs/ssr` a `dist/localized/{locale}/index.html`, con los textos
    saliendo del mismo XLIFF que la aplicación; corre tras `vite build`; el CSS
    va minificado y en línea; **el build comprueba el presupuesto de bytes y
    falla si se pasa**.
  - Verifica: con una landing de «hola mundo» en los dos idiomas — barato de
    rehacer si algo del pipeline no encaja. **Aquí se confirma que la i18n de
    Hosting convive con los rewrites de T25.**
  - Ficheros: `scripts/build-landing.mjs`, `src/landing/landing.ts`,
    `apps/web/package.json`, `firebase.json`
  - Nota: separar el pipeline del contenido es deliberado. Si el prerender falla,
    falla con «hola mundo» y no con la landing entera escrita.

- [ ] **T29 · Contenido de la landing (F11, segunda mitad)** · M · depende de T27, T28
  - Acepta: qué es planu en una frase, tres o cuatro bloques de valor, una
    captura real y una llamada a la acción; **utilidades CSS de Web Awesome sí,
    componentes no**; componentes propios en **light DOM**, sin Declarative
    Shadow DOM; SEO completo con Open Graph, `hreflang`, JSON-LD, `robots.txt` y
    `sitemap.xml`; un solo `<h1>` y jerarquía correcta.
  - Verifica: el HTML no contiene ninguna etiqueta `<script>`; se ve y se navega
    con JavaScript desactivado; axe en los dos idiomas; Lighthouse con
    rendimiento y SEO en 100 (`/webperf`)
  - Ficheros: `src/landing/landing.ts`, `hero.ts`, `features.ts`, `footer.ts`,
    `src/landing/landing.css`, `public/robots.txt`, `public/sitemap.xml`
  - Nota: **nada de lo que promete puede ser falso.** Si T22 no está entregada,
    la landing no dice que se integra con tu calendario.

> **Checkpoint F** — landing en dos idiomas, cero JavaScript, LCP en objetivo.

## Fase 12 — Producto: cierre

- [ ] **T30 · Privacidad, términos y cookies (F13)** · M · depende de T29, T31
  - Acepta: política que describe el tratamiento **real**, incluida la
    diferencia entre generar en el dispositivo y generar en la nube; términos
    proporcionados a un producto sin plan de pago; aviso de cookies **sólo si**
    T31 acaba usando algo que las requiera; ambos en los dos idiomas, generados
    con el prerender de T28 y enlazados desde el pie y el perfil.
  - Verifica: revisión manual contra el modelo de datos real; enlaces
    comprobados por e2e
  - Ficheros: `src/landing/legal.ts`, `src/landing/privacy.ts`,
    `src/landing/terms.ts`, `src/profile/profile-view.ts`
  - Nota: son textos honestos, no asesoramiento legal, y así se dice.

- [ ] **T31 · Analítica de activación (F16)** · M · depende de T25
  - Acepta: ADR 0009 con el proveedor elegido y qué se mide; cinco eventos y no
    más — visita, registro, **primer evento creado**, evento compartido, uso de
    la IA; **nunca contenido del usuario**; carga diferida, errores tragados, y
    la aplicación funciona igual con la analítica bloqueada.
  - Verifica: unitarios del envoltorio, incluido que traga errores y que no
    filtra campos del evento; e2e con la analítica bloqueada
  - Ficheros: `docs/adr/0009-*.md`, `src/analytics/track.ts` + test,
    `src/main.ts`
  - Nota: **bloqueada por la decisión de proveedor**, que además determina si T30
    lleva banner.

- [ ] **T32 · Borrado de cuenta y de datos (F14)** · M · depende de T13, T15, T18
  - Acepta: confirmación escribiendo el email, no un «¿seguro?»; borra en orden
    los eventos propios, sus imágenes, la entrada del directorio, las membresías
    en eventos ajenos y por último la cuenta de Auth; maneja
    `auth/requires-recent-login` reautenticando y reanudando; si se interrumpe,
    se puede reintentar; avisa de que los eventos compartidos desaparecen para
    sus invitados.
  - Verifica: e2e completo contra los emuladores con un usuario que tiene
    eventos propios, imágenes y una membresía ajena; no queda nada suyo
  - Ficheros: `src/account/delete-account.ts` + test,
    `src/profile/profile-view.ts`, `firestore.rules`
  - Nota: es la única tarea de producto que es **código delicado** y no
    contenido. Depende de la decisión tomada en T12.

- [ ] **T33 · Onboarding y primera sesión (F15)** · S · depende de T23
  - Acepta: el estado vacío explica qué hacer, con acciones directas para crear
    el primer evento a mano, desde imagen o desde texto; ofrece crear un evento
    de ejemplo **sólo si se pide**; nada de tour modal; sigue distinguiendo «no
    tienes eventos» de «tu búsqueda no encuentra nada», y sólo el primero enseña.
  - Verifica: e2e de usuario recién registrado que crea su primer evento sin
    salir del estado vacío; axe
  - Ficheros: `src/events/events-view.ts`, `src/events/empty-state.ts`

- [ ] **T34 · Documentación y cierre** · S · depende de todas
  - Acepta: `AGENTS.md`, `SPEC.md` y `docs/backend.json` reflejan el modelo y las
    rutas nuevas; ADRs 0004 a 0009 escritos y enlazados; `docs/spec-fase-2.md`
    marcado como entregado.
  - Verifica: revisión de enlaces y coherencia; `npm run lint`
  - Ficheros: `AGENTS.md`, `SPEC.md`, `docs/backend.json`, `docs/adr/README.md`

> **Checkpoint G** — los dieciséis criterios de éxito del spec, con `build`,
> `test`, `test:e2e`, `test:rules` y `lint` limpios.


---

## Fase 13 — Registro de invitaciones

Especificado en [`docs/spec-invitation-activity.md`](../docs/spec-invitation-activity.md).
Amplía F2: hoy una invitación es un aviso efímero que desaparece al decidirla.

- [ ] **T40 · Estado e historial de la invitación** · M · depende de T16
  - Acepta: `eventInvites` gana `status` (`pending` | `accepted` | `declined`),
    `createdAt` y `decidedAt`, y deja de borrarse al decidirla. La rama
    `acceptsInvite()` exige **`status == 'pending'`**, de modo que una
    invitación ya usada no sirve para volver a entrar: sin eso, conservar el
    registro haría que expulsar a alguien no significase nada.
  - Verifica: tests de reglas de cada transición permitida y, sobre todo, de las
    prohibidas — aceptar una ya aceptada, cambiar el rol al decidir, readmitirse
    uno mismo tras ser expulsado, borrar una decidida.
  - Ficheros: `firestore.rules`, `apps/web/rules/event-invites.test.ts`,
    `src/sharing/invitations.ts`

- [ ] **T41 · Página de invitaciones** · M · depende de T40, T25
  - Acepta: `/app/invitations` con pendientes arriba y decididas debajo, cada
    una con título, quién invita, rol, fecha de invitación y, si la hay, fecha y
    sentido de la decisión. Sobre una rechazada se puede reconsiderar. La
    sección del listado se queda sólo con las pendientes y enlaza aquí a partir
    de tres.
  - Verifica: e2e con dos sesiones del ciclo completo —invitar, rechazar,
    comprobar que queda registrado, reconsiderar y aceptar—; axe en la página.
  - Ficheros: `src/sharing/invitations-page.ts`,
    `src/sharing/invitations-inbox.ts`, `src/app-shell.ts`

**Pendiente de decidir** (en el spec): cuánto se conservan las decididas. Son
datos personales que crecen sin límite, y sin backend no hay quien las borre
solas. Entra en F13 (privacidad) y F14 (borrado de cuenta).

## Arquitectura hexagonal

De [`docs/spec-arquitectura-hexagonal.md`](../docs/spec-arquitectura-hexagonal.md)
y del plan en [`plan.md`](plan.md). **Todas dependen de T14**: la rama de
compartición toca `event-editor.ts` y `events-view.ts`, y migrarlos antes
garantiza conflictos.

- [x] **T35 · Sembrar las capas y levantar la frontera** · S · depende de T14
  - Acepta: **`domain/` existe** —las otras tres capas las crean T36, T37 y T38,
    cada una con su puerto, para no dejar carpetas vacías— y los seis módulos
    que no tocan Firebase —`filter-events`, `ai-availability`, `pick-locale`,
    `startup-buffer`, `format-dates`, `ai-policy`— y sus tests viven en ella;
    `biome.json` prohíbe `firebase/**` en **todo `apps/web/src/**`** mediante
    `style/noRestrictedImports` con `patterns`, y exime por nombre a los
    ficheros heredados en una lista que sólo puede encoger.
    La regla es un trinquete y no una lista de directorios protegidos: vigilar
    sólo `domain/` no impediría que naciera código nuevo acoplado.
  - Verifica: `npm run lint` sale **0**; se añade a mano un
    `import { doc } from "firebase/firestore"` a un fichero de `domain/`,
    `npm run lint` sale **1** con el diagnóstico, y se revierte. **Sin esa
    segunda mitad la regla no está probada.**
  - Ficheros: `biome.json`, movimientos con `git mv` bajo `src/domain/`

- [ ] **T36 · Puerto de sesión** · M · depende de T35
  - Acepta: `SessionPort` con `signIn`, `signUp`, `signInWithGoogle` y
    `signOut`; adaptador de Firebase en `infrastructure/`; `app-shell.ts`,
    `login-view.ts` y `profile-view.ts` no importan de `firebase/auth`;
    `auth-errors.ts` deja de importar `FirebaseError` y el adaptador traduce a
    un error de dominio, conservando los mensajes que ya valida su test.
  - Verifica: `npx vitest run application/` **sin emuladores levantados**; e2e
    de acceso; **comprobación manual del acceso con Google**, que no tiene e2e
    y cambia de camino en esta tarea
  - Ficheros: `src/application/ports/session.ts`, `src/application/sign-in.ts`
    y hermanos, `src/infrastructure/firebase/session-adapter.ts`, los tres
    componentes, `src/domain/auth-errors.ts`

- [ ] **T37 · Puerto de repositorio de eventos** · M · depende de T35, T14
  - Acepta: `EventRepository` con `save`, `delete` y `listFor`; el mapeo
    `Timestamp` ↔ `Date` y `PlanuEventDocument` se mudan a `infrastructure/`;
    `lib/types.ts` no importa de `firebase/firestore`; `events-view.ts`,
    `event-card.ts` y `event-editor.ts` tampoco.
  - Verifica: `npx vitest run application/` sin emuladores, con un repositorio
    en memoria; los 33 tests de reglas y los e2e de eventos siguen verdes. **Los
    tests de reglas no se tocan.**
  - Ficheros: `src/application/ports/event-repository.ts`, casos de uso,
    `src/infrastructure/firebase/event-repository.ts`, los tres componentes,
    `src/domain/event.ts`

- [ ] **T38 · Puerto de almacén de imágenes** · S · depende de T37
  - Acepta: `ImageStore.upload` con progreso; `firebase/storage.ts` pasa a ser
    el adaptador; ni `event-editor.ts` ni `ai-event-generator.ts` importan de
    `firebase/storage`; el progreso sigue llegando a `wa-progress-bar`.
  - Verifica: e2e de alta con imagen contra el emulador; unitario del caso de
    uso con un almacén en memoria
  - Ficheros: `src/application/ports/image-store.ts`,
    `src/infrastructure/firebase/image-store.ts`, los dos componentes

- [ ] **T39 · Cerrar la frontera** · S · depende de T36, T37, T38
  - Acepta: el `override` de Biome se extiende a `ui/**`; el andamiaje de
    contexto sin uso desaparece; `firebase/*` sólo aparece bajo
    `infrastructure/`.
  - Verifica: `grep -rl 'from "firebase/' src/ui/` **vacío**, más los 132 tests,
    `lint`, `typecheck`, `lint:lit` y `build` en código 0 comprobado con `$?`
  - Ficheros: `biome.json`, `src/infrastructure/firebase/context.ts`

> **Checkpoint H** — tras T35: la frontera es comprobable por comando y no ha
> cambiado ni una línea de comportamiento. Es el momento barato de abandonar.
> Tras T36, persona delante por el acceso con Google. Tras T39, suite completa
> y `grep` vacío.
