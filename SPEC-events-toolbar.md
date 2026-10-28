# Spec: extraer la barra de herramientas de `planu-events-view`

> No sustituye a [`SPEC.md`](SPEC.md), que sigue siendo la especificación del
> producto, ni a
> [`docs/spec-arquitectura-hexagonal.md`](docs/spec-arquitectura-hexagonal.md),
> que sigue gobernando puertos, dominio e infraestructura. Ésta cubre un
> cambio de estructura de UI dentro de esa migración: sembrar `src/ui/` (T39)
> con el primer componente que nace ya en su capa final, en vez de esperar a
> migrar todo `events/` de golpe.

## Objetivo

`planu-event-filters` ya sólo contiene búsqueda, rango de fechas, propiedad
(todo/mío/compartido) y tags — eso ya está separado. Lo que sigue suelto,
directamente en la plantilla de `events-view.ts` dentro de un único
`<div class="toolbar">`, son cuatro controles no relacionados entre sí más
que por compartir sitio: selector de vista, selector de orden, exportar y
crear. Esta tarea les da un componente propio, `planu-events-toolbar`, con la
misma lógica de extracción que ya se aplicó a los filtros — y lo sitúa
directamente bajo `src/ui/events/`, el primer fichero de esa capa.

**Quién se beneficia:** quien mantiene `events-view.ts`, hoy con 630 líneas
mezclando estado de listado, estado de editor/generador de IA y marcado de
cinco controles distintos. **Qué se considera éxito:** `events-view.ts`
compone dos elementos —`planu-event-filters` y `planu-events-toolbar`— en
vez de marcar cinco controles a mano, sin cambiar ningún comportamiento
visible ni ningún test existente.

## Alcance

**Dentro:**

- Nuevo componente `planu-events-toolbar` en
  `apps/web/src/ui/events/events-toolbar.ts`, agrupando:
  - selector de vista (hoy `wa-radio-group` + `viewOptions()`)
  - selector de orden (hoy `wa-select` + `sortOptions()`)
  - exportar (hoy `<planu-calendar-export mode="agenda">`)
  - crear (hoy `<wa-dropdown>` con "Crear manualmente" / "Generar con IA")
- Reordenar visualmente los cinco bloques de la toolbar (filtros + los cuatro
  anteriores): la disposición final se decide en `/plan`, con quien pidió la
  tarea, no aquí — ver Preguntas abiertas.
- Actualizar `events-view.ts` para consumir el nuevo componente en lugar de
  marcar los cuatro controles directamente.
- Tests unitarios del nuevo componente, análogos a `event-filters.test.ts`.

**Fuera:**

- Mover `planu-event-filters`, `event-card.ts`, `calendar-export.ts` ni
  ningún otro fichero de `events/` a `ui/events/`. Ésa es la migración
  completa de T39; aquí sólo se siembra el primer fichero.
- Cambiar el comportamiento de filtrado, orden, exportación o creación.
- Tocar `firestore.rules`, `storage.rules` o el modelo de datos.
- Tocar `domain/view-mode.ts` ni `domain/sort-events.ts`: ya son puros y ya
  están en su capa correcta.

## Tech stack

Igual que el resto del repo: Lit 3, Web Awesome 3, TypeScript 5.9,
`@lit/localize` para todo texto visible, Vitest 4 (modo navegador) para
unitarios, Playwright + axe para e2e. Nada nuevo que instalar.

## Comandos

```bash
npm run typecheck
npm run lint             # incluye la regla que impide `firebase/*` fuera de infrastructure/
npm run lint:lit
npm test                 # unitarios, Vitest en Chromium real
npm run test:e2e         # e2e existentes: views.spec.ts, calendar-export.spec.ts
npm run test:arch        # el trinquete de fronteras — ver Fronteras
```

## Estructura de proyecto (lo que cambia)

```
apps/web/src/
  ui/                          ← nuevo, primer fichero de la capa (T39)
    events/
      events-toolbar.ts          planu-events-toolbar + su test
      events-toolbar.test.ts
  events/
    event-filters.ts            sin cambios de contenido
    events-view.ts               dos elementos en vez de cinco controles
    calendar-export.ts          sin cambios; lo consume el nuevo componente
```

`ui/events/events-toolbar.ts` puede importar de `events/calendar-export.ts`
—la dirección es la correcta: componentes de mayor nivel consumiendo los de
menor nivel— sin que eso obligue a mover `calendar-export.ts` en esta misma
tarea.

## Estilo de código

Mismo patrón que `event-filters.ts`: un componente Lit con `@state` para lo
que decide internamente, `@property({ attribute: false })` para lo que
recibe de fuera, y un evento personalizado `composed: true, bubbles: true`
por cada decisión que le corresponde a quien lo contiene.

```ts
export interface ToolbarChange {
  view: ViewMode;
  sort: SortPreference;
}

@customElement("planu-events-toolbar")
export class PlanuEventsToolbar extends LitElement {
  @property({ attribute: false }) view: ViewMode = "list";
  @property({ attribute: false }) sort: SortPreference = /* ... */;
  @property({ attribute: false }) events: readonly StoredEvent[] = [];
  @property({ type: Boolean }) aiAvailable = false;

  // ...emite planu-toolbar-change, planu-create-option, igual que
  // event-filters emite planu-filters-change.
}
```

Los nombres exactos de las props y de los eventos personalizados —y si vista
y orden viajan en un evento combinado o en dos— se deciden en `/plan`, mirando
cómo cada uno se consume hoy en `events-view.ts` (los guardas contra
reasignación en bucle de `#onSort`/`#onView` tienen que sobrevivir la
extracción).

## Estrategia de test

- **Unitarios** (`ui/events/events-toolbar.test.ts`): que cambiar la vista
  emite el evento correcto con el valor correcto; mismo para orden; que el
  guarda contra reasignación en bucle (valor igual al actual no re-emite)
  sigue funcionando tras la extracción; que "Generar con IA" sólo aparece con
  `aiAvailable`; que exportar recibe los eventos visibles, no todos.
- **Existentes, sin tocar**: `event-filters.test.ts` no cambia — el
  componente no se toca. `views.spec.ts` y `calendar-export.spec.ts` (e2e)
  deben seguir pasando sin modificación de aserciones: son la prueba de que
  el comportamiento visible no cambió. Si alguno necesita tocarse porque el
  selector cambió de sitio en el DOM (por ejemplo, de `events-view` a
  `events-toolbar` dentro de su propio shadow root), el cambio se limita al
  selector, nunca a lo que se afirma.
- **`npm run test:arch`**: el nuevo fichero no debe aparecer en la lista de
  excepciones de `firebase/**` — no importa Firebase, y si terminase
  necesitándolo sería señal de que algo se diseñó mal.

## Fronteras

**Siempre**

- El nuevo componente no importa `firebase/*` bajo ningún concepto: si algo
  de lo que hoy vive en `events-view.ts` para estos cuatro controles resulta
  necesitarlo, se deja en `events-view.ts` y no se mueve.
- Todo texto visible nuevo pasa por `msg()`.
- `npm run test:arch` en 0 después del cambio, sin tocar
  `arch/boundary.test.ts` — este componente no es una excepción nueva a
  registrar, es un fichero limpio desde su nacimiento.
- Los 132+ tests existentes siguen en verde, sin borrar ni silenciar
  ninguno para acomodar la extracción.

**Preguntar primero**

- Cualquier reordenación visual que cambie qué controles caben en una fila en
  móvil (el CSS actual de `.toolbar` es `flex-wrap: wrap`; si la nueva
  disposición rompe eso en pantallas estrechas, se confirma antes de
  fusionar).
- Si el evento de vista y el de orden se combinan en un único
  `planu-toolbar-change` o se mantienen separados como hoy — afecta a cómo
  `events-view.ts` los escucha y no es neutro para quien lea el código luego.

**Nunca**

- Mover `event-filters.ts`, `event-card.ts` ni ningún otro fichero de
  `events/` a `ui/` como parte de esta tarea: eso es el resto de T39, con su
  propio plan.
- Cambiar `firestore.rules`, `storage.rules` o el esquema de eventos.
- Aplicar autofix de Biome (`--write`) sin revisar el diff — ver el punto 4
  de la configuración en `AGENTS.md`.

## Criterios de éxito

1. `events-view.ts` importa y renderiza `planu-events-toolbar` en vez de
   marcar `wa-radio-group`, `wa-select`, `planu-calendar-export` y
   `wa-dropdown` directamente en su plantilla.
2. `apps/web/src/ui/events/events-toolbar.ts` existe, no aparece en las
   excepciones de `firebase/**` de `biome.json`, y tiene test unitario propio.
3. `npm run typecheck`, `npm run lint`, `npm run lint:lit`, `npm test`,
   `npm run test:e2e` y `npm run test:arch` en **código de salida 0**,
   comprobado con `$?`.
4. `views.spec.ts` y `calendar-export.spec.ts` siguen verificando lo mismo
   que antes (mismas aserciones de comportamiento, selectores actualizados
   como mucho).
5. Ningún cambio en `domain/view-mode.ts`, `domain/sort-events.ts`,
   `firestore.rules` ni `storage.rules`.

## Preguntas abiertas

- **Disposición visual final de los cinco bloques** (filtros, vista, orden,
  exportar, crear). Se decidió que el spec cubre la extracción a componente y
  que la reorganización visual entra en el alcance, pero el orden concreto
  —qué va primero, si "crear" se separa visualmente del resto por ser la
  única acción que no filtra ni reordena— se fija en `/plan`, con una
  propuesta concreta para aprobar antes de tocar `events-view.ts`.
- **Un evento o dos** para vista/orden — ver "Estilo de código" arriba.
- **Nombre de fichero para el test**: junto al componente
  (`events-toolbar.test.ts`), siguiendo la convención de "Tests unitarios,
  junto al fuente" de `AGENTS.md`.
