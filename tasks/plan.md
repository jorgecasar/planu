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

**No se puede evaluar todavía: falta T21**, que es la que crea el conmutador y
la vista de agenda. Sin ella no hay tres vistas que medir. Dos de los tres
ítems dependen de ella y el tercero es manual.

- [ ] Las tres vistas con axe limpio — **bloqueado por T21.** Hoy hay axe sobre
      el listado y sobre la rejilla mensual (T20 lo mete incluso en el
      unitario), pero la agenda no existe.
- [ ] Un `.ics` generado se abre en Calendario de macOS y en Google Calendar —
      **pendiente de persona.** No hay forma de automatizarlo: hace falta abrir
      el fichero en dos aplicaciones reales.
- [ ] Los filtros funcionan igual en rejilla, calendario y agenda —
      **bloqueado por T21.**

### Checkpoint D — tras T24

- [ ] Pegar el texto de una convocatoria produce un borrador correcto
- [ ] Con la IA no disponible, el alta manual funciona igual

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

- [ ] El HTML de la landing no contiene ni una etiqueta `<script>`
- [ ] Se ve y se navega con JavaScript desactivado
- [ ] LCP < 1,5 s en 4G simulada; presupuesto de bytes respetado
- [ ] Los textos salen del mismo XLIFF que la app, en los dos idiomas

### Checkpoint H — tras T39 · arquitectura hexagonal

Vive en [`todo.md`](todo.md) y no estaba aquí: este plan es anterior a
[`docs/spec-arquitectura-hexagonal.md`](../docs/spec-arquitectura-hexagonal.md).
Se enumera para que la lista de checkpoints esté completa.

- [x] Tras T35: la frontera es comprobable por comando y no ha cambiado ni una
      línea de comportamiento — `npm run test:arch` → **0**, 7 aserciones
- [ ] Tras T36: persona delante, por el acceso con Google, que no tiene e2e
- [ ] Tras T39: suite completa y `grep -rl \'from "firebase/\' src/ui/` vacío

### Checkpoint G — final

- [ ] Los dieciséis criterios de éxito del spec
- [ ] `npm run build`, `npm test`, `npm run test:e2e`, `npm run test:rules` y
      `npm run lint` limpios
- [ ] ADRs 0004 a 0009 escritos
- [ ] `AGENTS.md`, `SPEC.md` y `docs/backend.json` al día

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
