# Plan de implementación — fase 2

Deriva de [`docs/spec-fase-2.md`](../docs/spec-fase-2.md). El **porqué** de cada
decisión está allí; aquí está el **orden**, las dependencias y dónde se verifica.

El plan de la fase 1, ya completado, se archivó en
[`tasks/fase-1/`](fase-1/plan.md).

## Resumen

Dieciséis funcionalidades en veinticuatro tareas, repartidas en dos corrientes
que apenas se tocan:

- **Funcionalidad** (F1–F9): compartir con invitados, export a calendario,
  vistas de calendario y agenda, etiquetas, y dos usos nuevos de la IA.
- **Producto** (F10–F16): landing prerenderizada, identidad visual, legales,
  borrado de cuenta, onboarding y analítica.

El único puente entre ambas es **T32** (borrado de cuenta), que necesita el
modelo de datos ya cerrado.

## Estado de partida

Lo que ya existe y este plan da por bueno:

- La fase 1 completa: auth, CRUD de eventos privados, búsqueda y filtros,
  editor con subida de imagen, generación con IA e i18n.
- **Banco de pruebas de reglas ya montado**: `@firebase/rules-unit-testing`
  instalado, `npm run test:rules` con `vitest.rules.config.ts`, y
  `apps/web/rules/firestore.test.ts` cubriendo privacidad, propiedad y forma del
  documento. Esto elimina una pregunta abierta del spec y hace que T13 sea
  ampliar un arnés existente en vez de construirlo.
- CI en `.github/workflows/ci.yml` que corre todas las comprobaciones.

Lo que **no** existe y hace falta desde el primer día: **Java**. Ver bloqueos.

## Decisiones de arquitectura

Tomadas y cerradas en el spec; se repiten aquí porque condicionan el orden:

- **Membresía dentro del documento del evento** (`memberIds` + `roles`), no en
  una subcolección. Evita un `get()` facturable por evaluación de regla y es
  obligatorio de todas formas para la consulta `array-contains`.
- **Landing prerenderizada en el build** con `@lit-labs/ssr`, 0 KB de JS. Lo que
  hace que esto sea la opción buena y no solo la rápida: `msg()` funciona al
  renderizar en Node, así que la landing usa el mismo XLIFF que la aplicación.
- **Sin backend.** Ni Cloud Functions ni Blaze. Marca el límite de tres cosas:
  no hay invitaciones pendientes, no hay recordatorios propios, y el borrado de
  cuenta no puede ser transaccional.

## Grafo de dependencias

```
T11 Java y emuladores ─────────┐
                               │   (sin esto no se verifica casi nada)
T12 ADRs 0004/0005 ────────────┤
                               ▼
                    T13 Esquema y reglas ──→ T14 Membresía al crear + backfill
                               │                        │
                               │                        ▼
                               │              ┌──── CHECKPOINT A ────┐
                               ▼              │                      │
                    T15 Directorio ──→ T16 Compartir ──→ T17 Bandeja │
                               │                                     │
                               │                          CHECKPOINT B
                               │
      ┌────────────────────────┼─────────────────────────┐
      ▼            ▼           ▼            ▼            ▼
   T18 Tags   T19 Orden   T20 Mes   T21 Agenda      T22 .ics     (paralelizables)
      │                                                  │
      │                                       CHECKPOINT C
      ▼
   T24 Sugerir tags ←── T23 Desde texto      CHECKPOINT D


CORRIENTE DE PRODUCTO (independiente de todo lo anterior)

   T25 Mudanza a /app ──→ CHECKPOINT E (despliegue)
            │
            ├──→ T26 Decidir paleta ──→ T27 Tokens y tipografías
            │                                    │
            ▼                                    ▼
   T28 Pipeline de prerender ────────→ T29 Landing ──→ CHECKPOINT F
                                             │
                                             ├──→ T30 Legales
                                             └──→ T31 Analítica

   T32 Borrado de cuenta  ←── depende de T13, T15, T18 y de la decisión de T12
   T33 Onboarding
   T34 Documentación y cierre ──→ CHECKPOINT G
```

**Ruta crítica:** T11 → T13 → T15 → T16 → T17. Es la más larga y la que más
tarda en dar valor visible.

**Lo más arriesgado va pronto**, en dos sitios distintos: T13 (reglas, donde un
error es una fuga) y T25 (mudanza a `/app`, donde un error deja la aplicación
inaccesible).

## Fases y checkpoints

| Fase | Tareas | Checkpoint |
| --- | --- | --- |
| 5 · Precondiciones | T11, T12 | Los emuladores arrancan y `npm run test:rules` pasa |
| 6 · Modelo y reglas | T13, T14 | **A** — la app hace exactamente lo mismo que antes, con el modelo nuevo y sin regresiones |
| 7 · Compartir | T15, T16, T17 | **B** — dos usuarios, permisos verificados por reglas y no por la UI |
| 8 · Organización | T18, T19, T20, T21, T22 | **C** — sesenta eventos se navegan por mes, etiqueta y orden |
| 9 · IA | T23, T24 | **D** — las dos rutas nuevas de IA con el modelo simulado |
| 10 · Producto, cimientos | T25 | **E** — la app vive en `/app` y se despliega sin romper nada |
| 11 · Producto, cara | T26, T27, T28, T29 | **F** — landing en dos idiomas, 0 KB de JS, LCP en objetivo |
| 12 · Producto, cierre | T30, T31, T32, T33, T34 | **G** — todos los criterios del spec |

**No se avanza de fase con la anterior en rojo.**

Dos bloques de trabajo posteriores a este plan viven **sólo en
[`todo.md`](todo.md)**, igual que ya pasaba con la arquitectura hexagonal
(Checkpoint H): la **arquitectura hexagonal** (T35–T39) y **horas en eventos**
(T44–T55, de [`docs/spec-horas-en-eventos.md`](../docs/spec-horas-en-eventos.md),
con sus propios checkpoints I–IV, ya cerrados a 22/08/2026). Se enumeran aquí
para que la tabla de fases no dé la impresión de que el trabajo se detiene en
T34.

### Cómo se marcan estas casillas

Una casilla se marca **sólo con la evidencia al lado**: el comando y su código
de salida, o el fichero y la línea. Lo que dependa de una persona o de una
comprobación manual se queda sin marcar y dice quién falta, en vez de marcarse
por optimismo.

**La tarea que cierra una fase evalúa su checkpoint en el mismo commit.** Las
demás tareas de la fase dejan su evidencia en su propia entrada de
[`todo.md`](todo.md) y no tocan este fichero: varias ramas escribiendo en las
mismas líneas garantizan conflicto, y ninguna puede cerrar sola un checkpoint
que depende de sus hermanas.

*Evaluados el 16 de agosto de 2026, con retraso: las tareas de A, B y E llevaban
cerradas desde hacía tiempo y estas casillas seguían vacías. La regla de arriba
existe por eso.*

### Checkpoint A — tras T14

- [x] `npm run test:rules` en verde, incluidos los casos que **deniegan** —
      `npm run test:rules` → **0**, 135 tests
- [x] `npm test` y `npm run test:e2e` sin regresiones — **0** y **0**
- [ ] ~~Un evento creado antes del cambio sigue apareciendo en el listado~~ —
      **es falso hoy, y a sabiendas.** Un evento heredado sin `memberIds` no lo
      lee ni su dueño: rescatarlo con una cláusula extra en `allow read` hace
      que Firestore deniegue **toda** consulta de listado, así que se dejó
      denegando limpiamente hasta el backfill. Lo fija el test *«not even its
      owner can read it: only the backfill fixes that»* en
      `apps/web/rules/firestore.test.ts`, y el backfill sigue sin entregarse
      (ver T14). **Bloquea el despliegue, no el desarrollo.**
- [ ] Revisión humana de `firestore.rules` antes de seguir — **pendiente de
      persona.** No lo puede marcar un agente.

Este checkpoint es deliberadamente aburrido: **nadie ha ganado funcionalidad**.
Es la forma de saber que el cambio de modelo no rompió nada antes de construir
encima.

### Checkpoint B — tras T17

- [x] Dos sesiones reales: el dueño invita, el invitado ve —
      `e2e/sharing.spec.ts`, seis tests con dos sesiones, en verde
- [x] Un lector no puede editar **según las reglas**, no solo según la UI —
      tests de denegación en `apps/web/rules/firestore.test.ts`
- [x] Un editor no puede ascenderse ni quedarse la propiedad — ídem, y
      confirmado por el red-team contra los emuladores (`AGENTS.md`)
- [x] Cero violaciones de axe en el diálogo de compartir —
      *«the share dialog has no accessibility violations»*, en verde

### Checkpoint C — tras T22

**Cerrado.** Evaluado con T21, que es la tarea que cierra la fase: dos ítems con
oráculo automático y el tercero verificado a mano, porque abrir un fichero en
dos aplicaciones reales no lo puede hacer un agente.

- [x] Las tres vistas con axe limpio — `npm run test:e2e` → **0**:
      *«las tres vistas no tienen violaciones de accesibilidad»*
      (`apps/web/e2e/views.spec.ts`) recorre rejilla, calendario y agenda **con
      el conjunto de reglas por defecto**, afirmando en cada vuelta qué
      componente está en pantalla —si no, un conmutador roto dejaría el bucle
      midiendo Tarjetas tres veces— y que `passes` no está vacío, porque «cero
      violaciones» y «no se ha mirado» se escriben igual. Las dos vistas nuevas
      tienen además axe en el **unitario** —`calendar-view.test.ts` y
      `agenda-view.test.ts`, con el tema de Web Awesome cargado y asserteando
      también el `incomplete` de `color-contrast`, que sin el tema es donde se
      esconde «no he podido mirar»—; la rejilla de tarjetas lo tiene en
      `events.spec.ts` desde antes.
- [x] Un `.ics` generado se abre en Calendario de macOS y en Google Calendar —
      **verificado a mano el 17 de agosto de 2026**, en las dos: se descargó un
      `.ics` desde una tarjeta y abre correctamente en Calendario de macOS y en
      Google Calendar.
      No se puede automatizar: hace falta abrir el fichero en dos aplicaciones
      reales, y es una de las tres clases que `AGENTS.md` dice que un agente
      nunca cierra. Google Calendar es el que de verdad pone a prueba el plegado
      de líneas a 75 octetos de `domain/build-ics.ts`, más quisquilloso que
      Calendario: por eso el ítem pedía las dos y no una.
- [x] Los filtros funcionan igual en rejilla, calendario y agenda —
      `npm run test:e2e` → **0**: *«los filtros se aplican en el calendario»* y
      *«los filtros se aplican en la agenda»* (`apps/web/e2e/views.spec.ts`).
      Estructuralmente lo garantiza `events-view.ts`, donde las tres vistas
      cuelgan de la **misma** llamada a `filterEvents`; y no es sólo estructura:
      el mutante que le pasa al calendario los eventos sin filtrar, y el mismo
      para la agenda, mueren los dos en esos e2e.

### Checkpoint D — tras T24

- [x] Pegar el texto de una convocatoria produce un borrador correcto —
      verificado con una sesión real de Gemini Nano, conduciendo el Chrome del
      autor: seis textos distintos, año y semántica de inicio/fin correctos en
      los seis. Evidencia completa en la entrada de T23 de `todo.md`.
- [x] Con la IA no disponible, el alta manual funciona igual — cubierto para
      las dos rutas: `apps/web/e2e/ai.spec.ts` (generar desde imagen o texto) y
      `apps/web/e2e/events.spec.ts:377,394` (sugerir etiquetas). Las tres
      forzando disponibilidad y dejando que el intento real falle en silencio,
      que es el camino que de verdad se da en cualquier entorno sin IA
      integrada. `npm run test:e2e` → **0**, 60 e2e.

### Checkpoint E — tras T25 · el más delicado

- [x] `/app`, `/app/login` y `/app/profile` funcionan — los e2e navegan a las
      tres y pasan. **Matiz que conviene no perder:** corren contra
      `npm run dev`, no contra el emulador de Hosting, así que lo verificado es
      el enrutado del cliente, no la configuración de `firebase.json`.
- [ ] Los enlaces antiguos redirigen — **sin verificar automáticamente, y no se
      puede.** Las redirecciones 301 viven en `firebase.json` y los e2e nunca
      ven esa configuración; es la misma limitación que `AGENTS.md` documenta
      para la CSP y las cabeceras de caché. Se comprueba a mano tras desplegar.
- [x] **Todos los e2e existentes pasan con las rutas nuevas** —
      `npm run test:e2e` → **0**
- [ ] ~~Desplegado a un canal de previsualización antes de tocar producción~~ —
      **obsoleto.** El [ADR 0005](../docs/adr/0005-sin-entornos-de-preview.md)
      eliminó los canales de preview, así que esta casilla no se puede marcar
      nunca. Se deja tachada en vez de borrada: el ítem documenta una decisión
      que cambió, y borrarlo escondería que este plan es anterior al ADR.

### Checkpoint F — tras T29

**No se marca entero: el LCP no llega.** Evaluado el 22/08/2026 contra
producción, mediana de 5 pasadas de Lighthouse.

- [x] El HTML de la landing no contiene ni una etiqueta `<script>`
- [x] Se ve y se navega con JavaScript desactivado
- [ ] LCP < 1,5 s en 4G simulada — mediana real: **1,9 s** (rango 1,4–2,5 s en
      5 pasadas). Presupuesto de bytes sí respetado: cada página bajo 16 KiB
      de HTML+CSS en línea, tope 24 KiB.
- [x] Los textos salen del mismo XLIFF que la app, en los dos idiomas

### Checkpoint H — tras T39 · arquitectura hexagonal

Vive en [`todo.md`](todo.md) y no estaba aquí: este plan es anterior a
[`docs/spec-arquitectura-hexagonal.md`](../docs/spec-arquitectura-hexagonal.md).
Se enumera para que la lista de checkpoints esté completa.

- [x] Tras T35: la frontera es comprobable por comando y no ha cambiado ni una
      línea de comportamiento — `npm run test:arch` → **0**, 7 aserciones
- [ ] Tras T36: persona delante, por el acceso con Google, que no tiene e2e
- [ ] Tras T39: suite completa y `grep -rl \'from "firebase/\' src/ui/` vacío

### Checkpoint G — final

- [ ] Los dieciséis criterios de éxito del spec — **no se marca entero**: el
      LCP de F11 (1,9 s medido, no 1,5 s), el cierre de la arquitectura
      hexagonal (T37–T39, sesión migrada pero repositorio de eventos y
      almacén de imágenes sólo en `event-editor.ts`) y el registro de
      invitaciones (T40–T41, fase 13, sin empezar) siguen abiertos. Ver la
      cabecera de estado de `docs/spec-fase-2.md`, añadida en T34.
- [ ] `npm run build`, `npm test`, `npm run test:e2e`, `npm run test:rules` y
      `npm run lint` limpios — **parcial.** T34 verificó `npm run lint`
      (→ 0), `npm run typecheck` (→ 0) y `npm run test:arch` (→ 0, 11 tests)
      porque es un cambio sólo de documentación; no re-ejecutó `build`,
      `test`, `test:e2e` ni `test:rules` completos, que no dependen de esta
      tarea y exigen emuladores que un worktree comparte con otras sesiones.
      La última ejecución completa registrada de cada uno está en las
      entradas de T32/T54 en `todo.md`.
- [x] ADRs 0004 a 0010 escritos —diez ficheros, no nueve: T55 añadió
      `docs/adr/0008-all-day-flag-y-zona-horaria.md` sin darse cuenta de que
      `0008` ya lo ocupaba `0008-identidad-visual.md` (T26/T27, desde el
      21/08). Renombrado a `0010` antes de T34 (commit `eca962b`) — ver la
      entrada de T55 en `todo.md`. El objetivo pasa de «0004 a 0009» a «0004
      a 0010». `docs/adr/README.md` (T34) los indexa los diez, en orden.
- [x] `AGENTS.md`, `SPEC.md` y `docs/backend.json` al día — T34: los tres
      reescritos y verificados contra el código real (rutas, modelo de
      datos, capas, `TOPE_ACOPLADOS`), no copiados de `tasks/todo.md` sin
      comprobar. Ver la evidencia de T34 en `todo.md`.

## Paralelización

- **Seguras en paralelo:** T18, T19, T22 entre sí; T20 y T21 comparten ficheros,
  así que van seguidas. Toda la corriente de producto (T25–T31) es independiente
  de la de funcionalidad.
- **Estrictamente secuenciales:** T13 → T14 (reglas antes que datos), T15 → T16
  → T17 (cadena de compartición), T25 antes que T28 y T29.
- **Necesitan coordinación:** T18 y T24 comparten la normalización de etiquetas;
  se define en T18 y T24 la consume.

## Riesgos y mitigación

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Un fallo en las reglas de T13 es una fuga de datos, no un bug | **Alto** | Los tests de denegación se escriben **antes** que la regla; revisión humana en el checkpoint A; el arnés ya existe |
| T25 puede dejar la aplicación inaccesible: el rewrite `**` vigente devolvería la SPA para cualquier URL | **Alto** | Va sola, con su propio commit, probada contra el emulador de Hosting y desplegada primero a un canal de previsualización |
| `hashing.sha256().toHexString()` puede no existir en reglas de Firestore | Medio | **Se confirma en el emulador en T15 antes de escribir nada**; plan B documentado: email en claro comparado con `request.auth.token.email` |
| La i18n de Hosting puede no convivir con los rewrites de T25 | Medio | Se comprueba en T28, cuando el pipeline ya genera ficheros pero la landing aún no tiene contenido: barato de rehacer |
| `@lit-labs/ssr` está en `labs`, API sin estabilizar | Bajo | Solo en el build, solo plantillas propias, sin hidratar. El peor caso es congelar la versión |
| T20 (rejilla mensual) es lo más propenso a violaciones de axe del proyecto | Medio | Teclado y roles ARIA desde el primer commit, no al final |
| El borrado en cascada de T32 no puede ser transaccional | Medio | Orden que deja Auth para el final y reanudable en el siguiente acceso; se avisa al usuario |
| «Forma de producto» se desborda | Medio | Acotado a siete tareas con criterios verificables. Dominio, precios y marketing quedan fuera |

## Bloqueos abiertos

Uno detiene la verificación desde el primer día; los otros tres detienen tareas
concretas.

1. **Java no está instalado.** `java -version` falla en esta máquina. Los
   emuladores de Firestore y Storage lo exigen, así que **ni `npm run test:rules`
   ni los e2e con datos sembrados pueden correr**. Es lo primero que hay que
   resolver (T11) y es acción del usuario:

   ```bash
   brew install openjdk
   export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # en ~/.zshrc
   ```

2. **Proveedor de analítica sin decidir** (T31). Firebase Analytics ya está en el
   stack pero pone cookies y obliga a banner; una alternativa sin cookies lo
   evita a cambio de una dependencia. **Determina si T30 lleva banner**, así que
   conviene decidirlo antes de escribir los legales.

3. **Paleta y tipografías sin decidir** (T26). Adoptar el indigo `#3F51B5` con
   Belleza y Alegreya del blueprint, ajustarlo o descartarlo. Bloquea T27 y, por
   tanto, T29.

4. **«Salir de un evento ajeno»** (T12). Si un usuario puede quitarse a sí mismo
   de `memberIds`, hay que abrir una excepción acotada en las reglas. **Se decide
   en T12 y se implementa en T13**: cambiar reglas ya desplegadas es mucho más
   caro que decidirlo ahora.

Heredado de la fase 1 y aún por confirmar: **Firebase Storage no estaba dado de
alta en `planu-app`**. Los e2e corren contra el emulador, así que no bloquea el
desarrollo, pero sí un despliegue real con imágenes.

## Fuera de alcance

Está en el spec, y se repite aquí para que no se cuele por la puerta de atrás:

- Eventos recurrentes.
- Notificaciones push y recordatorios por email (exigen Blaze).
- Precios, cobro y página de planes.
- Invitaciones pendientes para quien aún no tiene cuenta.
- Dominio propio.
- Revisar `docs/blueprint.md`, salvo la parte de identidad visual que resuelve
  T26.

---

# Arquitectura hexagonal · T35–T39

Especificación en
[`docs/spec-arquitectura-hexagonal.md`](../docs/spec-arquitectura-hexagonal.md).

## Por qué

El objetivo es **testabilidad, no portabilidad**. Firebase se queda. Hoy la
lógica interesante vive dentro de componentes que hablan con el SDK, así que
comprobar que guardar un evento sin título da error exige levantar Java,
Firestore, Auth y Storage. Los puertos del emulador ya bloquearon el trabajo dos
veces en un día por chocar con otra sesión.

Eso descarta puertos que espejen el SDK: son **finos y por operación**, en el
lenguaje del dominio.

## Lo medido, que corrige suposiciones

**El dominio ya está limpio.** `eventSchema()` usa `z.coerce.date()`, así que
`PlanuEvent` trabaja con `Date`. El único `Timestamp` está en
`PlanuEventDocument`, que es explícitamente la forma de persistencia: se muda,
no se rediseña.

**No hay once módulos puros, hay seis que se mueven solos.** Sin dependencias
externas: `filter-events`, `ai-availability`, `pick-locale`, `startup-buffer`.
Sólo con `@lit/localize`: `format-dates`, `ai-policy`. Los otros tres —`guard`
(`User`), `auth-errors` (`FirebaseError`), `lib/types` (`Timestamp`)— importan
de Firebase: son trabajo, no mudanza.

**El acoplamiento real**, contando sólo importaciones de valor:

| Componente | Usa de Firebase |
| --- | --- |
| `app-shell.ts` | `signOut` |
| `auth/login-view.ts` | `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInWithPopup`, `GoogleAuthProvider` |
| `profile/profile-view.ts` | `signOut` |
| `events/event-card.ts` | `deleteDoc`, `doc` |
| `events/events-view.ts` | `collection`, `query`, `where`, `Timestamp` |
| `events/event-editor.ts` | `addDoc`, `setDoc`, `collection`, `doc`, `Timestamp` |
| `events/ai-event-generator.ts` | sólo tipos |

Se agrupa en **tres puertos**: sesión, repositorio de eventos y almacén de
imágenes. Nada más. De ahí salen las rodajas T36, T37 y T38 — verticales, cada
una con su puerto, su adaptador, sus casos de uso y sus componentes.

## Decisión que el spec no cerraba

**`@lit/localize` sí puede vivir en `domain/`.** `eventSchema()` usa `msg()`
para los mensajes de validación y la fábrica existe justo para que se resuelvan
al idioma correcto. Sacarlos obligaría a que el dominio devolviera códigos y la
interfaz los tradujera: más limpio en abstracto, pero no sirve al objetivo,
porque `msg()` funciona en tests sin montar nada. **La regla prohíbe
`firebase/*`, no `@lit/localize`.**

## Grafo

```
T14 (membresía, en feat/event-sharing)
 └── T35 (capas + frontera)
      ├── T36 (sesión)
      ├── T37 (repositorio de eventos)  ← también depende de T14
      │    └── T38 (almacén de imágenes)
      └── T39 (cerrar la frontera)  ← depende de T36, T37 y T38
```

## Regla permanente para la fase 2

Cualquier tarea de T15 en adelante que toque un componente **lo deja tras su
puerto antes de darse por hecha**. Va a `AGENTS.md` y no como tarea suelta: es
lo que hace incremental la migración en vez de dejar dos estilos conviviendo
para siempre.

## Riesgos

- **Mover ficheros ensucia el historial.** `git mv` en su propio commit, sin
  cambios de contenido mezclados.
- **Conflicto con `feat/event-sharing`.** Por eso todo cuelga de T14.
- **T37 es la rodaja gorda**: tres componentes y el modelo. Si se alarga, se
  parte en listar / guardar / borrar, que son independientes.

## Verificación de extremo a extremo

```bash
npm run lint && npm run typecheck && npm run lint:lit && npm run build
npx vitest run --root apps/web application/      # sin emuladores: esto es el objetivo
firebase emulators:exec --only auth,firestore,storage \
  "npm test && npm run test:rules && npm run test:e2e"
grep -rl 'from "firebase/' apps/web/src/ui/      # debe salir vacío
```

Comprobando **códigos de salida**, no la salida. Y a mano: alta con imagen,
edición, borrado y acceso con Google.

---

# Fiabilidad de CI · T57

Especificación en
[`docs/spec-ci-e2e-reliability.md`](../docs/spec-ci-e2e-reliability.md). Tarea
única, sin dependencias, arrancada desde `main` en su propia rama
(`fix-ci-e2e-retries`) y sin relación con la arquitectura hexagonal — se
intercala aquí sólo porque el diagnóstico salió al revisar el run de CI que
fusionó T40.

## Orden

No hay grafo real: es una tarea XS de dos ficheros de configuración, sin
paralelizar y sin fases intermedias.

1. Quitar los reintentos en CI de ambas configs de Playwright (ya hecho en el
   working tree; falta verificar).
2. Verificación local: `npm run test:e2e` completo contra los emuladores, sin
   reintentos, repetido para confirmar que no hay una tasa de fallo real
   detrás de lo que antes tapaban los reintentos.
3. Verificación en CI real, en dos partes: el arreglo pasa limpio, y una
   rotura deliberada (revertir `retries: 0` o forzar un fallo sin reintento
   posible) hace fallar el job — el trinquete probado, no supuesto.

## Riesgos

- **Falso positivo de estabilidad.** Esta máquina comparte emuladores de
  Firebase con otras sesiones en worktrees paralelos (ver «Worktrees
  paralelos» en la memoria del agente); un fallo local aislado puede ser
  contención, no una regresión real. Se distingue repitiendo la tanda en
  aislamiento antes de concluir nada.
- **El timeout de 30 s podría no bastar bajo el runner de GitHub Actions**,
  incluso sin reintentos escondiéndolo. Fuera de alcance por decisión
  explícita (ver el spec); si aparece, se abre una tarea nueva en vez de
  subirlo a ciegas aquí.

## Verificación

```bash
npm run test:e2e                                 # local, sin reintentos
npm run lint && npm run typecheck                # higiene, no tocado por el cambio
gh run view <id> --json conclusion,jobs          # CI real: código de salida, no el log
```

## Checkpoint I

- [ ] `apps/web/playwright.config.ts` y `apps/web/playwright.landing.config.ts`
      tienen `retries: 0` bajo CI — sin la rama `process.env["CI"] ? 2 : 0`.
- [ ] `npm run test:e2e` en local, repetido, pasa sin ningún reintento — o
      cualquier fallo que aparezca se corrigió, no se dejó pendiente.
- [ ] Un run de CI real sobre el arreglo termina en `conclusion: success` con
      cero tests *flaky*.
- [ ] Un run de CI roto a propósito —posterior al de arriba— termina en
      `conclusion: failure`, confirmando que el trinquete funciona en ambos
      sentidos.

## Ampliación: cuelgue de sesión en producción

Salió investigando el punto 3 de arriba, y se atendió aquí por ser la misma
investigación aunque no comparte causa con la inestabilidad de CI —detalle
completo en `docs/spec-ci-e2e-reliability.md`—. Un script de sondeo contra
`https://planu-app.web.app/app/login` confirmó que `onAuthStateChanged`
(`firebase-provider.ts`) a veces no dispara nunca: 5 de 23 arranques con
perfil de navegador nuevo se quedaron atascados en el spinner, sin ningún
error observable. Afinado tras una pregunta del usuario: el cuelgue es
específico de la primera vez que un navegador crea la base de IndexedDB de
Auth contra el backend real (0/8 recargando el mismo perfil, 2/10 con
perfil nuevo en la misma ventana) y **no se reproduce contra el
emulador** (0/12) — así que no explica los 10/83 del run de CI, que sigue
sin causa confirmada.

Arreglo elegido por el usuario: timeout de seguridad, no perseguir la causa
exacta dentro de `firebase-js-sdk`. Implementado en
`src/domain/session-check-timeout.ts` (helper puro) y `app-shell.ts`
(sustituye el spinner infinito por un aviso de recarga a los 8 s). Tests
nuevos en ambos, TDD con rojo/verde verificado. Detalle completo con toda
la evidencia en la entrada de T57 en `tasks/todo.md`.

- [ ] Verificación pendiente: repetición contra producción tras desplegar,
      con una muestra de al menos 20 arranques y cero atascos —criterio 5
      de éxito del spec—.

---

# Flujo único de creación de evento · T58

Especificación en
[`docs/spec-flujo-creacion-evento.md`](../docs/spec-flujo-creacion-evento.md).
Tarea única (T58), sin dependencias, arrancada desde `main` en su propio
worktree (`t-new-event-button`). Sustituye el desplegable «Nuevo evento» —hoy
un `wa-dropdown` con «Crear manualmente» / «Generar con IA» que abre uno de
dos diálogos distintos según la elección— por un único botón que siempre abre
`event-editor.ts`; si la IA está disponible, un bloque embebido al principio
del propio formulario ofrece rellenarlo desde imagen o texto, con una acción
explícita para descartarlo y escribir a mano. `empty-state.ts` (T33) queda
fuera de alcance: no se toca su interfaz, sólo converge su wiring.

## Orden

No se separa "primero el generador, luego el editor, luego la vista" en tres
pasos verdes independientes: `lint:lit` resuelve los bindings `.property=`
contra las properties reales del custom element vía `HTMLElementTagNameMap`,
así que quitar `open` de `PlanuAiEventGenerator` mientras `events-view.ts`
todavía le hace `.open=${this.generatorOpen}` rompe `lint:lit` de inmediato —
no hay un estado intermedio útil que conservar.

1. **Reestructuración central**, los tres archivos de producción a la vez —
   `ai-event-generator.ts` (se le quita el `<wa-dialog>` propio, pasa a ser
   un `<fieldset>` embebido con un booleano `#disposed` en vez del contador
   de cancelación `#generation`, `type="button"` explícito en sus dos
   botones de acción para no enviar el formulario del evento en el que
   pasa a vivir), `event-editor.ts` (monta el bloque como primer hijo de
   `<form id="event-form">` tras un getter derivado `#showAiBlock`,
   gestiona el foco al ocultarlo), `events-view.ts` (un único
   `<wa-button>`, sin `wa-dropdown` ni el modal standalone) — manteniendo
   `lint`, `typecheck`, `lint:lit` y `test` en verde. Incluye el ajuste de
   la línea de `ai-event-generator.test.ts` que deja de compilar
   (`el.open = true`).
2. **Tests unitarios nuevos**: cancelación al desconectar, `type="button"`
   en ambos botones y el flujo de texto completo en
   `ai-event-generator.test.ts`; contrato completo del bloque embebido en
   `event-editor.test.ts` (aparece/desaparece según `event`/`draft`/
   `aiAvailable`/descarte, foco tras ocultarlo, regresión del envío de
   formulario). `npm test` en verde.
3. **E2e**: `openEditor()` sin el `menuitem` intermedio, los seis tests de
   `ai.spec.ts` actualizados, dos tests de axe nuevos (con y sin bloque de
   IA). `npm run test:e2e` en verde.
4. **Barrido de verificación** (sin cambios de código esperados):
   `npm run test:arch` confirma que `biome.json`/`arch/boundary.test.ts` no
   necesitan tocarse; `grep` del repo para rastros muertos.
5. **Puerta final + comprobación manual**: los cinco comandos de
   verificación de principio a fin, más un paso manual en el servidor de
   desarrollo (imagen, texto, «Escribir a mano», sin IA) y un chequeo de
   accesibilidad del editor con y sin el bloque.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Los dos botones del bloque de IA envían el formulario del evento al vivir dentro de `<form id="event-form">` | `type="button"` explícito en ambos, con su propio test de regresión que comprueba que `eventRepository.create`/`update` no se llaman |
| El foco cae a `<body>` cuando el bloque desaparece del DOM (descarte o generación con éxito) — el análisis estático de axe no lo detecta por sí solo | Ambos handlers mueven el foco al campo de título tras `updateComplete`, con test dedicado |
| `lint:lit` rompe a mitad de migración si `open` desaparece de `PlanuAiEventGenerator` antes de que `events-view.ts` deje de referenciarlo | Los tres ficheros de producción cambian de contrato en un solo paso, no en pasos verdes independientes |

## Verificación

```bash
npm run lint && npm run typecheck && npm run lint:lit && npm test
npm run test:e2e
npm run test:arch
grep -rn 'generatorOpen\|planu-generator-close\|#onEmptyGenerate\|#onCreateOption\|"Create manually"' apps/web/src
```

## Checkpoint I

- [x] Los tres ficheros de producción (`ai-event-generator.ts`,
      `event-editor.ts`, `events-view.ts`) cambiaron de contrato a la vez;
      `lint`, `typecheck`, `lint:lit` y `test` en verde tras el paso 1, y
      de nuevo tras las correcciones del checker en `bbd8ed6`:
      `./node_modules/.bin/biome check .` → 0/169 (el wrapper de
      `npm run lint` daba un falso «ESLint output» ajeno a Biome, ver
      T57); `npx tsc --noEmit` → 0; `npm run lint:lit` → 0/125;
      `npm test` → 0, 595/595 (50 ficheros).
- [x] Los tests nuevos de `ai-event-generator.test.ts` (5, líneas 320,
      340, 362, 379, 395) y de `event-editor.test.ts` (9 del plan más 1
      extra, sección «AI fill-in block (embedded)», líneas 1012–1235)
      están escritos y en verde.
- [x] `npm run test:e2e`, incluidos los dos tests de axe nuevos (con y
      sin bloque de IA): tres corridas completas (85 tests), fallos que
      no se repiten entre corridas (71/85, 76/85, y 74/85 limpios +10
      *flaky* +1 persistente con `--retries=2`), todos con la firma ya
      diagnosticada en `docs/spec-ci-e2e-reliability.md`
      (`page.goto("/app/login")` seguido de un timeout de 30 s, sin
      relación con el bloque de IA). Los dos axe tests nuevos y el resto
      de `ai.spec.ts` pasaron limpios en las tres corridas — ver
      `tasks/todo.md`, T58, para el detalle completo. No es una firma de
      fallo nueva.
- [x] `grep` de rastros muertos (`generatorOpen`, `planu-generator-close`,
      `#onEmptyGenerate`, `#onCreateOption`, `"Create manually"`) vacío.
- [x] Comprobación manual en el servidor de desarrollo: crear con imagen,
      con texto y con «Escribir a mano» — los tres aparecen en el listado
      sin recargar (o, en el camino de imagen, tras quitar la portada; ver
      el hallazgo de abajo). El sub-caso «sin IA» no se puede forzar desde
      la UI en el dispositivo real de prueba y se apoya en su lugar en
      `ai.spec.ts:120` y `:261`, ya verificados en el checkpoint anterior.
      Chequeo de accesibilidad del editor con y sin el bloque de IA: los
      dos axe tests (`ai.spec.ts:241`/`:261`) más una inspección manual del
      panel "Issues" de Chrome DevTools, sin cambios de recuento entre
      ambos estados y con avisos ya atribuidos a `<wa-select>` de Web
      Awesome fuera del bloque de IA. Detalle completo, incluida la
      investigación de red que llevó al hallazgo siguiente, en
      `tasks/todo.md`, T58.
      **Hallazgo real, ajeno a T58**: guardar el borrador de imagen con su
      portada puesta fallaba con `net::ERR_ABORTED` en la escritura de
      Firestore; el registro del emulador señaló
      `firestore.rules:170` — la regla `isValidEvent()` exige que
      `imageUrl` empiece por `https://firebasestorage.googleapis.com/`
      (anti-SSRF, anclado a producción) y el Storage **emulador** sirve sus
      URLs de descarga en `http://localhost:9199/...`, así que cualquier
      evento con portada creado en local contra el emulador topa con esto
      — antes de T58 también, vía la subida manual de imagen de
      `event-editor.ts`. No reproduce en producción. No se toca
      `firestore.rules` en esta tarea: es un cambio de seguridad fuera de
      alcance que exigiría `security-auditor` por delante.

---

# Verificación de email obligatoria e invitaciones sin revelar cuenta · T59–T66

Especificación en
[`SPEC-verificacion-email-invitaciones.md`](../SPEC-verificacion-email-invitaciones.md).
Arrancada en su propia rama (`feat/email-verification-and-invites`) desde
`main`, sin relación con T35–T39 ni con T57.

## Por qué

Verificado, no supuesto (ver el spec): una cuenta de email/contraseña puede
crear, leer y editar eventos sin verificar nunca su correo — la verificación
sólo gobierna hoy si esa cuenta aparece en el directorio de compartición. Y
`share-dialog.ts` revela hoy, con un mensaje distinto, si un email invitado
tiene cuenta o no — una fuga que el propio ADR 0007 ya documentó y dejó
pendiente de cerrar.

**Bug real encontrado durante la propia sesión de spec**, no en este plan:
comprobado contra Firebase de producción, una cuenta verificada de verdad
(`emailVerified: true` en Auth) nunca llegó a publicarse en `userDirectory`,
porque `profile-view.ts` oculta el aviso de "verifica tu email" **antes** de
que la publicación al directorio tenga éxito, y un fallo silencioso deja el
aviso desaparecido para siempre. Es la causa por la que T59 va primero y no
es opcional: la Parte B de este plan reclama invitaciones pendientes en los
mismos dos disparadores que este bug rompe, así que sin arreglarlo primero,
todo lo que se construya encima hereda el mismo agujero silencioso.

## Grafo

```
T59 Arreglar el aviso de verificación   T60 Reglas: email_verified en events   T62 Reglas: eventInvitesByEmail
 (sin dependencias — bug real,           (sin dependencias)                     (sin dependencias)
  independiente de A y B)                       │                                      │
        │                                       ▼                                      │
        │                              T61 Guard en cliente                             │
        │                                       │                                      │
        │                             CHECKPOINT A                                      │
        │                                                                               ▼
        └───────────────────────────────────────────────────────────→ T63 claimPendingInvitesByEmail()
                                                                        (depende de T59 y T62)
                                                                               │
                                                                               ▼
                                                            T64 share-dialog sin revelar cuenta
                                                                (depende de T62 y T63)
                                                                               │
                                                                     CHECKPOINT B
                                                                               │
                                                                               ▼
                                                     T65 Instrumentación (depende de T59, T63)
                                                                               │
                                                                               ▼
                                                          T66 ADRs + cierre de fase
                                                          (depende de todas las anteriores)
                                                                               │
                                                                     CHECKPOINT C (final)
```

**T59, T60 y T62 no dependen entre sí y son las tres candidatas a paralelizar
desde el primer momento** — ficheros distintos entre T59 y las otras dos;
T60 y T62 comparten fichero (`firestore.rules`) pero secciones separadas, así
que el riesgo es de conflicto de merge, no de dependencia lógica real. T61
sólo tiene sentido después de T60 (el cliente debe reflejar lo que las
reglas ya exigen, aunque no compartan fichero). T63 es el primer punto de
convergencia real: necesita el bug de T59 corregido en el mismo fichero que
va a tocar, y la colección de T62 ya definida en reglas.

## Fases y checkpoints

| Fase | Tareas | Checkpoint |
| --- | --- | --- |
| 1 · Verificación obligatoria | T59, T60, T61 | **A** — reglas y cliente exigen email verificado, sin regresión, y el mecanismo para detectarlo ya no se rompe en silencio |
| 2 · Invitar sin revelar cuenta | T62, T63, T64 | **B** — invitar a quien tiene cuenta no cambia; invitar a quien no tiene cuenta no revela nada y no se pierde |
| 3 · Cierre | T65, T66 | **C (final)** — los 6 criterios de éxito del spec, con `security-auditor` y `code-reviewer` sin hallazgos abiertos |

### Checkpoint A — tras T59–T61

- [x] `npm run test:rules` en 0 — 186/186 (33 anteriores + los nuevos de T60:
      3 en `firestore.test.ts` para create/read/update sin verificar, 1 para
      el caso editor, 1 para `acceptsInvite()` en `event-invites.test.ts`, 1
      para `leavesTheEvent()` añadido tras el hallazgo LOW del
      `security-auditor`). Verificado por maker, checker y security-auditor
      de forma independiente, no una sola vez. Commit `7c674be`.
- [x] `npm test` en 0 — 590/590, incluyendo `profile-view.test.ts` (T59) y
      `guard.test.ts` ampliado (T61). Verificado por los tres agentes por
      separado en distintos momentos, siempre en verde.
- [ ] Prueba manual: una cuenta real sin verificar no puede crear un evento;
      tras verificar y pulsar "I have verified it", sí puede, sin cerrar
      sesión — y el aviso desaparece **sólo** si el directorio se publicó de
      verdad. **Sin marcar**: nadie ha ejecutado esto todavía contra una
      cuenta real (emulador o producción) con clics e inputs reales, sólo
      contra la suite automatizada. Pendiente de quien tenga acceso para
      hacerlo — ver la nota de `AGENTS.md` sobre por qué esta clase de
      verificación no la cierra un agente por sí solo.

### Checkpoint B — tras T62–T64

- [x] Invitar a un email con cuenta existente se comporta exactamente igual
      que hoy (regresión 0, mismo mensaje de éxito). Verificado por maker y
      checker de T64, con mutación deliberada del código para confirmar que
      los tests lo detectarían si dejara de ser cierto. `npm test` 604/604.
- [x] Invitar a un email sin cuenta ya no muestra el mensaje que revela su
      ausencia, y la oferta queda guardada en `eventInvitesByEmail` con la
      forma exacta que exige `firestore.rules` — confirmado contra
      `npm run test:rules` (204/204) y contra un `test:e2e` real (emulador
      aislado, no aceptado de palabra).
- [ ] Esa persona, si se registra con ese email, lo verifica y pasa por uno
      de los dos disparadores de T63, ve la invitación en su bandeja sin que
      nadie la reenvíe. **Sin marcar, a sabiendas — no es cierto todavía.**
      T63 descubrió que en `eventInvitesByEmail` un `list` sin filtrar se
      deniega —sólo pasa la consulta del propio dueño por `invitedBy`, el
      invitado sigue sin poder listar— y ninguno de los dos disparadores
      tiene un `eventId` en contexto:
      `claimPendingInvitesByEmail()` es hoy un no-op documentado en
      producción. Aceptado explícitamente por el usuario como hueco
      conocido (ver `SPEC-verificacion-email-invitaciones.md`, "Lo que
      esto NO resuelve"), pendiente de una tarea futura que reabra las
      reglas de T62 o encuentre un disparador con `eventId` a mano.

### Checkpoint C (final) — tras T65–T66

- [x] Los 6 criterios de éxito de `SPEC-verificacion-email-invitaciones.md`
      marcados uno a uno, cada uno con su evidencia — ver la entrada de T66
      en `tasks/todo.md`. Cinco cumplidos; el 4 (reclamo automático) no
      cumplido a sabiendas, tachado desde T63.
- [x] `security-auditor` lanzado dos veces sobre `firestore.rules` durante
      el cierre (hallazgo real en `eventInvites` + `eventInvitesByEmail`,
      corregido y reconfirmado con pruebas propias) y `code-reviewer` real
      sobre el diff completo de la rama, dos veces también (REQUEST
      CHANGES por un hallazgo Importante de arquitectura → migrado →
      reconfirmado cerrado, de forma independiente) — ver evidencia en la
      entrada de T66 de `tasks/todo.md`.
- [x] `npm run lint`, `npm run typecheck`, `npm run lint:lit`, `npm test`,
      `npm run test:rules` en 0. `npm run test:e2e` no llega a 0
      (inestabilidad ya documentada, aceptada explícitamente por el usuario
      con evidencia de dos corridas — ver T66 en `tasks/todo.md`).
- [ ] **Bloqueo sin cerrar, a propósito — no lo cierra un agente**: si ya
      hay cuentas reales sin verificar en producción (`planu-app`) con
      eventos creados, la Parte A las bloquearía hasta que verifiquen. No
      comprobado — requeriría acceso de administración y una decisión de
      quien tenga esa vista, no de quien implementó la tarea.
- [ ] El bloqueo abierto sobre cuentas ya existentes sin verificar en
      producción (ver "Bloqueos abiertos") está resuelto o explícitamente
      diferido por una persona, no por un agente.

## Riesgos y mitigación

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Colisión de número de ADR con otra rama concurrente (ya pasó en T34, dos ficheros `0008-*.md` el mismo día) | Medio | T66 comprueba `ls docs/adr/` en el momento de escribir, no reserva `0011`/`0012` de antemano |
| El bug de T59 no es la única causa de publicación fallida del directorio | Medio | T65 instrumenta antes de que T66 cierre la fase — no se asume "arreglado" sin evidencia nueva |
| `firestore.rules` es zona de "luces encendidas" | Alto si se salta | `security-auditor` obligatorio en el Checkpoint final, en paralelo a `code-reviewer`, nunca en su lugar |
| T60/T62 tocan el mismo fichero (`firestore.rules`) en paralelo | Bajo | Coordinar el orden de merge entre ambas tareas antes de abrir cualquier PR; conflicto de texto, no de lógica |
| Cuentas reales ya existentes sin verificar en producción, con eventos creados | Alto si se despliega sin decidirlo | Bloqueo abierto explícito — ver abajo, no lo cierra un agente |

## Bloqueos abiertos

- **Cuentas ya existentes sin verificar en producción.** No comprobado en
  este plan: requiere una consulta de administración más amplia que la
  puntual ya hecha sobre una sola cuenta durante el spec, y decidir el
  criterio (¿bloquear directamente, o avisar antes?) es de quien pidió la
  tarea, no de un agente. Bloquea el despliegue de T60/T61, no su
  implementación ni sus tests.
- **Fiabilidad real de "recargar/volver a entrar" como disparador de
  `publishDirectoryEntry`/`claimPendingInvitesByEmail`.** Ver la pregunta
  abierta homónima del spec. T65 debe dejar evidencia de test, no una
  suposición corregida por otra suposición.

## Fuera de alcance

- Cerrar del todo la fuga de "oráculo de un email" del ADR 0007 — sin
  backend no se puede, y montar uno es justo lo que esta conversación
  decidió no hacer ahora.
- Cloud Functions, plan Blaze, o cualquier envío de correo real.
- Compartir por enlace (`SPEC-compartir-por-enlace.md`, todavía sin pasar
  por `/spec`).
- Extraer `planu-events-toolbar` (`SPEC-events-toolbar.md`) — deprioritizada
  frente a este trabajo en la propia conversación que generó ambos spec.
