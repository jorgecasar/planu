# Spec · Arquitectura hexagonal en planu

> No sustituye a [`SPEC.md`](../SPEC.md), que sigue siendo la especificación del
> producto. Ésta cubre un cambio estructural, igual que
> [`docs/spec-fase-2.md`](spec-fase-2.md) cubre las funcionalidades pendientes.

## Objetivo

**Poder probar la lógica de la aplicación sin emuladores.**

Hoy la suite tarda porque casi todo lo interesante ocurre dentro de componentes
que hablan con el SDK de Firebase. Levantar Java, Firestore, Auth y Storage para
comprobar que al guardar un evento sin título aparece un error es caro, lento y
frágil: los puertos del emulador ya han bloqueado el trabajo dos veces en un
solo día por chocar con otra sesión.

El objetivo **no** es poder cambiar de proveedor. Firebase se queda. Eso descarta
puertos que espejen el SDK y mapeos en las dos direcciones: los puertos son
**finos y por operación** —`guardarEvento`, `listarEventosDe`, `subirImagen`—,
expresados en el lenguaje del dominio y no en el de Firestore.

### Punto de partida, medido

| | |
| --- | --- |
| Componentes que importan de `firebase/*` | **7** de 9 |
| El peor | `event-editor.ts`: `auth`, `firestore` **y** `storage` |
| Módulos ya puros y con tests | **11** |

Y una corrección sobre lo que parecía el peor caso: **el modelo de dominio ya
está limpio**. `eventSchema()` usa `z.coerce.date()`, así que `PlanuEvent`
trabaja con `Date`. El único `Timestamp` vive en `PlanuEventDocument`, que es
explícitamente la forma de persistencia. No hay que rediseñar nada ahí: hay que
mover ese tipo a infraestructura, que es donde le corresponde.

## Cómo se concilian «capas» e «incremental»

Son dos respuestas en tensión: reorganizar por capas es mover casi todo de una
vez; incremental es lo contrario. Se resuelve en dos tiempos:

1. **Sembrar las capas de una vez, con lo que ya está limpio.** Los 11 módulos
   puros —`filter-events`, `pick-locale`, `ai-policy`, `format-dates`, `guard`,
   `auth-errors`, `startup-buffer`…— ya *son* dominio y aplicación, sólo que en
   la carpeta equivocada. Moverlos es mecánico, no cambia una línea de lógica y
   deja la estructura en pie para que lo demás tenga destino.
2. **Migrar lo acoplado tarea a tarea.** Cada tarea de la fase 2 que toque un
   componente lo deja tras su puerto antes de darse por hecha. Sin parón y sin
   refactor masivo.

Durante la migración conviven los dos estilos. Es aceptable y es temporal; lo
que **no** es aceptable es que un módulo ya migrado vuelva a importar del SDK, y
para eso está la regla de lint.

## Estructura

```
apps/web/src/
  domain/          Modelo y reglas. Cero dependencias externas.
    event.ts         eventSchema(), PlanuEvent, filter-events, format-dates
  application/     Casos de uso. Dependen de puertos, nunca de adaptadores.
    ports/           EventRepository, ImageStore, SessionProvider…
    save-event.ts    …y un fichero por caso de uso
  infrastructure/  Adaptadores. Único sitio donde se importa firebase/*.
    firebase/        provider, controllers, storage, mapeo Timestamp↔Date
    sentry/          el que ya existe en observability/
  ui/              Componentes Lit. Consumen casos de uso, no adaptadores.
    auth/ events/ profile/
```

`PlanuEventDocument` y el mapeo `Timestamp` ↔ `Date` van a
`infrastructure/firebase/`. `domain/` no sabe que Firestore existe.

## Comandos

Los de siempre; no se añade ninguno.

```bash
npm run lint        # incluye la regla que impide importar firebase/* fuera de infrastructure/
npm run typecheck
npm test            # unitarios; los de dominio y aplicación, sin emuladores
npm run test:rules
npm run test:e2e
npm run build
```

## Estilo

Un puerto es una interfaz en `application/ports/`, nombrada por lo que la
aplicación necesita y no por quien lo cumple:

```ts
/** Lo que la aplicación necesita para guardar eventos. Firestore es un detalle. */
export interface EventRepository {
  save(event: PlanuEvent, ownerId: string): Promise<string>;
  listFor(ownerId: string): AsyncIterable<StoredEvent>;
}
```

El caso de uso recibe el puerto, nunca lo construye:

```ts
export async function saveEvent(
  repo: EventRepository,
  session: SessionProvider,
  values: unknown,
): Promise<Result> { … }
```

Los componentes siguen usando `@consume` de `@lit/context`, pero lo que
consumen pasa a ser el caso de uso o el puerto, no `Firestore`.

## Estrategia de tests

- **`domain/`**: unitarios puros. Sin dobles, sin emuladores.
- **`application/`**: unitarios con dobles del puerto, en memoria. **Es la
  medida del éxito**: si un caso de uso necesita emulador, el puerto está mal.
- **`infrastructure/`**: los tests de integración que ya existen, contra los
  emuladores. Los 33 de reglas no se tocan.
- **`ui/`**: e2e como hasta ahora.

Los 132 tests actuales deben seguir pasando en cada paso. Ninguno se borra ni se
silencia para acomodar la estructura.

## Criterios de éxito

Medibles, para que un check los decida:

1. **`npm run lint` falla si un fichero de `domain/` o `application/` importa de
   `firebase/*`.** Regla en `biome.json` con `overrides` por ruta. Es la
   frontera; sin ella la arquitectura es una carpeta con buenas intenciones.
2. **Cada caso de uso migrado tiene un test que corre sin emuladores.**
   Comprobable: `npx vitest run application/` sin levantar nada.
3. **`grep -rl 'from "firebase/' src/ui/` no devuelve nada** al terminar.
4. Los 132 tests siguen verdes, y `lint`, `typecheck`, `lint:lit` y `build`
   salen con **código 0** —comprobado con `$?`, no leyendo la salida.

## Fronteras

**Siempre**

- Un puerto por lo que la aplicación necesita, no por lo que el SDK ofrece.
- Cada migración, en su commit, con los tests pasando antes y después.
- La regla de lint entra **con el primer módulo migrado**, no al final.

**Preguntar primero**

- Añadir dependencias.
- Mover ficheros que `feat/event-sharing` esté tocando: hay otra sesión ahí.
- Cambiar el modelo de datos o las reglas de seguridad.

**Nunca**

- Puertos que espejen el SDK: el objetivo es testabilidad, no portabilidad.
- Un refactor masivo en un solo commit.
- Borrar o silenciar un test que falla para que encaje la estructura.
- Tocar `firestore.rules` como parte de esto. Es otra conversación.

## Preguntas abiertas

- **Orden respecto a `feat/event-sharing`.** Esa rama toca `event-editor.ts` y
  `events-view.ts`, dos de los siete acoplados. Migrarlos antes de fusionarla
  garantiza conflictos, así que la fusión va primero.

## Resuelto durante la especificación

**Biome sí restringe importaciones por ruta.** `overrides` con `includes` y
`style/noRestrictedImports` se combinan. Comprobado en los dos sentidos: exit 0
sobre un fichero limpio, exit 1 con diagnóstico sobre uno que importa
`firebase/firestore`. La forma:

```jsonc
"overrides": [
  {
    "includes": ["apps/web/src/domain/**", "apps/web/src/application/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": {
      "level": "error",
      "options": { "paths": {
        "firebase/firestore": "El dominio no conoce al proveedor: usa un puerto.",
        "firebase/auth": "…",
        "firebase/storage": "…"
      } }
    } } } }
  }
]
```

Que la frontera sea comprobable con un comando importa más allá de la higiene:
convierte la migración de cada módulo en una tarea con oráculo binario, y por
tanto candidata al peldaño 3 de la escalera de autonomía.
