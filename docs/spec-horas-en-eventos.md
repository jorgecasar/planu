# Spec: horas de inicio y fin

Amplía [`spec-fase-2.md`](spec-fase-2.md), donde un evento ocupa **días** y
nada más fino. Este documento le añade la hora, y con ella la distinción
explícita entre un evento de día completo y una cita con hora.

## Objetivo

Un planificador de eventos que no sabe la hora sirve para las vacaciones y no
para la cena del viernes. Hoy `startDate` y `endDate` son `Timestamp` en
Firestore, pero todo lo que hay por encima los trata como fechas de calendario.

Tres consecuencias, y una de ellas es una pérdida de dato:

1. **El editor no deja escribir la hora.** `event-editor.ts:342` y `:348` son
   dos `wa-input type="date"`, y `#onSubmit` reconstruye el instante con
   ``new Date(`${value}T00:00:00`)`` (`event-editor.ts:615`).
2. **La IA ya extrae la hora y el editor la descarta.** El prompt pide
   explícitamente `YYYY-MM-DDTHH:mm` «cuando hay hora»
   (`generate-event.ts:53`), los ejemplos de `generate-from-text.ts:114` la
   incluyen, `toDate()` la parsea bien — y luego `toInputDate()` la corta al
   rellenar el formulario. Quien fotografía un cartel que dice «21:00» pierde
   ese 21:00 sin ningún aviso.
3. **No se puede expresar «empieza a medianoche».** `build-ics.ts` deduce si un
   evento es de día completo comprobando que sus fechas caigan en el comienzo
   de su día local (`isStartOfDay`). Es la única señal disponible, y su propio
   comentario ya anticipa el problema: *«si algún día lleva bandera de todo el
   día, este detector sobra y el dato manda»*.

**Éxito** = alguien crea «Cena el 4 de julio de 19:30 a 23:00», la ve con su
hora en la tarjeta, en la agenda y en la rejilla del mes, la exporta a su
calendario y allí también son las 19:30; y quien crea «Vacaciones del 1 al 15
de agosto» no ve ninguna hora en ninguna parte.

## Lo que ya está hecho y lo que falta

Conviene tenerlo delante, porque cambia mucho el tamaño de la feature.

| Pieza | Estado |
| --- | --- |
| `Timestamp` en Firestore | **Ya guarda instantes.** Nada que migrar |
| `firestore.rules` | Sólo exige `is timestamp`. Admite horas hoy |
| `build-ics.ts` | **Ya emite `DTSTART`/`DTEND` con hora en UTC.** Sólo falla al *decidir* si el evento la tiene |
| `google-calendar-url.ts` | Ya distingue los dos formatos, vía `calendarWindow()` |
| `sort-events.ts` | Ordena por `getTime()`, así que **el orden por hora ya funciona** |
| `agenda-days.ts` | Agrupa por día y ordena con `sortEvents`: **el orden dentro del día ya es correcto** |
| `generate-event.ts` | Ya pide, parsea y valida `YYYY-MM-DDTHH:mm` |
| Editor | No hay campo de hora |
| `format-dates.ts` | `Intl.DateTimeFormat` sin `hour`/`minute` |
| `month-grid.ts` | **No ordena**: reparte en el orden en que le llegan, y `events-view.ts:420` le pasa `visible` sin ordenar |
| Bandera de día completo | No existe |

## Alcance

### Dentro

- **Campo `allDay`** en el documento, en el esquema y en las reglas.
- **Editor**: hora de inicio y hora de fin, opcionales, junto a sus fechas.
- **Tarjeta**: la hora en `formatEventDates()`, con formato de la locale.
- **Exportación**: `.ics` y enlace de Google Calendar deciden por el campo, no
  deduciendo.
- **Agenda y rejilla mensual**: la hora visible, y la celda del mes **ordenada**.
- **Filtro de rango**: horas, no sólo días.
- **IA**: dejar de perder la hora que el modelo ya extrae, en imagen y en texto.
- **Siembra** (`scripts/seed-emulator.js`): eventos con hora entre los once, o
  no hay con qué probar a mano.

### Fuera, y por qué

- **Zona horaria del evento.** Se guarda el instante y cada invitado lo ve en la
  zona de su navegador, que es lo que ya hace `Timestamp`. Un campo `timeZone`
  IANA obligaría a emitir `VTIMEZONE` en el `.ics` y merece su propio ADR. Ver
  «Preguntas abiertas».
- **Duración, recurrencia y recordatorios.** Nada de `RRULE` ni `VALARM`.
- **Detectar solapes** entre eventos del mismo usuario.
- **Zona horaria en la interfaz.** No se muestra «CEST» ni un selector.

## Decisiones tomadas

### 1. La bandera `allDay` es explícita

`isStartOfDay()` desaparece de `build-ics.ts`. Un evento sabe lo que es porque
lo dice, no porque lo parezca.

```
{ startDate: 2026-07-04T00:00, endDate: null, allDay: true  }  → todo el día
{ startDate: 2026-07-04T00:00, endDate: null, allDay: false }  → medianoche
```

El coste es una entrada más en `hasOnly` de las reglas y una aserción más en la
suite de reglas. La alternativa —seguir deduciéndolo— deja «empieza a
medianoche» inexpresable para siempre, y la deducción es justo lo que se rompe
al dejar escribir `00:00`.

### 2. Fecha y hora en campos separados

Cuatro `wa-input`: `date`, `time`, `date`, `time`. La hora vacía significa día
completo, que es el caso mayoritario y así no cuesta nada expresarlo.

Con `datetime-local` el navegador presenta siempre un hueco de hora y haría
falta un interruptor de «todo el día» aparte: más estado y más que probar para
el mismo resultado.

### 3. Se guarda el instante; se pinta en la zona del navegador

Sin cambios respecto a hoy. Un evento a las 19:30 en Madrid se ve a las 13:30
en Bogotá. Es correcto para una videollamada y confuso para una cena
presencial; se acepta a sabiendas porque hoy no hay usuarios en varias zonas y
el arreglo tiene un coste desproporcionado. Queda registrado como pregunta
abierta, no como olvido.

### 4. La hora es opcional, y `allDay` es una sola bandera para el evento

No hay «inicio con hora y fin sin hora». Escribir cualquiera de las dos horas
pone `allDay: false`; borrar las dos lo devuelve a `true`. Un evento con
`allDay: false` y una sola hora es legítimo —significa duración cero o fin
abierto, que el modelo ya admite—, pero la bandera es del evento entero, no de
cada extremo.

Motivo: RFC 5545 tampoco permite mezclarlo. Un `VEVENT` con `DTSTART;VALUE=DATE`
y `DTEND` con hora es inválido, así que un modelo con dos banderas produciría
datos que no se pueden exportar.

### 5. Con `allDay: true`, las fechas se normalizan al comienzo del día local

Al guardar, `startDate` y `endDate` se recolocan en `new Date(año, mes, día)`.
Así el dato es honesto: un evento de día completo no arrastra una hora residual
de cuando la tuvo, y `toIcsDate()` puede seguir leyendo componentes locales.

Con componentes locales y nunca con `toISOString()`, por el mismo motivo que
`toInputDate` (ver su comentario): al este de Greenwich UTC devuelve el día
anterior.

### 6. Un evento de día completo sigue vigente hasta el final de su último día

Esto **arregla un defecto que ya existe**. `activeUntil()`
(`sort-events.ts:172`) devuelve `endDate` tal cual, y para un evento de día
completo de hoy eso es hoy a las 00:00. A las 00:01 `groupOf()` ya lo manda a
«pasado»: un evento de día completo que ocurre hoy aparece bajo «Pasados» todo
el día.

Con `allDay` explícito se puede corregir: si es de día completo, sigue activo
hasta el final de su último día. Sin la bandera no se podía distinguir de una
cita puntual a medianoche, y de ahí que llegue con esta feature y no antes.

Es un cambio de comportamiento visible y va **en su propio commit**, con su
test, separado del resto.

### 7. La rejilla mensual ordena dentro de la celda

`month-grid.ts` no ordena y `events-view.ts:420` le pasa `visible` sin ordenar,
así que hoy dos eventos del mismo día salen en el orden que devolvió Firestore.
Con día suelto casi no se nota; con horas, es una lista de horas desordenadas.

Ordena `buildMonthGrid` con `sortEvents`, igual que ya hacen `groupEvents` y
`buildAgenda`, para que el criterio del usuario mande también aquí. No lo hace
quien llama: el orden dentro de la celda es una propiedad de la rejilla y debe
tener test propio.

## Modelo de datos

```ts
// lib/types.ts
allDay: z.boolean().default(true),
```

**`default(true)` y no `false`**: los eventos anteriores a esta feature no
traen el campo, y todos ellos son de día completo —el editor los guardó a
`T00:00:00`—. Con `false` por defecto, cada evento existente se convertiría en
una cita de medianoche en el `.ics` de todo el mundo.

En `PlanuEventDocument` el campo entra como `allDay: boolean`. El `refine` de
`startDate <= endDate` no cambia: con hora, inicio igual a fin es duración cero
y `calendarWindow` ya sabe omitir el `DTEND` en ese caso.

Cuando el evento no tiene ninguna fecha, `allDay` no significa nada. Se guarda
`true` y no se lee.

## Reglas

En `firestore.rules`, dentro de `isValidEvent()`:

- `allDay` entra en `hasOnly` — sin ello, escribirlo se rechaza.
- **No entra en `hasAll`.** Es la misma razón, ya documentada, por la que `tags`
  tampoco está: los eventos anteriores no lo traen y exigirlo los volvería
  ineditables.
- `(!('allDay' in d) || d.allDay is bool)`.

No hace falta tocar `changesContentOnly()`: sólo enumera los campos de
pertenencia (`userId`, `memberIds`, `roles`, `createdAt`), así que `allDay`
cuenta como contenido y un editor invitado puede cambiarlo. Es lo correcto:
quien puede mover la fecha puede quitar la hora.

Aserciones nuevas en `apps/web/rules/firestore.test.ts`:

- acepta `allDay: true` y `allDay: false`;
- rechaza `allDay: 'true'` (cadena) y `allDay: 1`;
- un evento **sin** `allDay` sigue siendo editable.

El test existente «rejects an unknown field however tiny» sigue pasando: se
añade una clave permitida, no se abre la lista.

## Interfaz

### Editor

La fila `.dates` ya es un `flex-wrap` con `flex: 1 1 10rem` por hijo, así que
pasar de dos a cuatro campos se reparte solo y en móvil se apila sin tocar el
CSS. Se agrupan en dos parejas para que la hora no se separe de su fecha al
envolver:

```
┌────────────┬────────┐  ┌────────────┬────────┐
│ Fecha ini. │ Hora   │  │ Fecha fin  │ Hora   │
│ 04/07/2026 │ 19:30  │  │ 04/07/2026 │ 23:00  │
└────────────┴────────┘  └────────────┴────────┘
                      (hora vacía = todo el día)
```

`enterkeyhint="done"` se mueve al último campo, que ahora es la hora de fin.

`format-dates.ts` gana `toInputTime(date)`, hermana de `toInputDate`, que
devuelve `HH:mm` con componentes locales y `""` para `null`. Con `allDay`, `""`.

### Texto del periodo

`formatEventDates()` pasa a recibir `allDay`. Las combinaciones que ya cubre
—las cuatro de fechas presentes o ausentes— se multiplican por dos, y una
merece decisión explícita: **un evento con hora que empieza y acaba el mismo día
no repite la fecha.**

```
Vacaciones (día completo, varios días)  → «1 ago 2026 – 15 ago 2026»
Cena (con hora, mismo día)              → «4 jul 2026, 19:30 – 23:00»
Congreso (con hora, varios días)        → «4 jul 2026, 9:00 – 6 jul 2026, 18:00»
Cena sin fin declarado                  → «Empieza el 4 jul 2026, 19:30»
```

La hora sale de `Intl.DateTimeFormat` con `hour` y `minute`, así que el reloj de
12 o 24 horas lo elige la locale y no nosotros.

### Agenda y rejilla mensual

- **Agenda**: pinta `planu-event-card`, así que hereda el formato anterior sin
  cambios. El orden dentro del día ya es correcto.
- **Rejilla mensual**: la celda muestra la hora delante del título cuando el
  evento la tiene, y sólo el día en que empieza —un congreso de tres días no
  repite «9:00» en los tres—. Y ordena (decisión 6).

### Filtro de rango

`event-filters.ts:239` fabrica hoy el rango con `T00:00:00` y `T23:59:59` sobre
dos `<input type="date">`. Se añade hora a cada extremo, con el mismo criterio
que el editor: vacío significa el día entero, así que el comportamiento actual
es exactamente el caso de horas vacías y no hay regresión posible para quien no
las use.

`filter-events.ts` no cambia: compara instantes y ya lo hacía bien.

## La regla de las capas, y qué obliga aquí

`AGENTS.md` es explícito y no deja margen: **toda tarea que toque un componente
acoplado lo deja tras su puerto antes de darse por hecha.** Esta feature toca
dos ficheros de la lista de exenciones de `biome.json`:

- `apps/web/src/events/event-editor.ts` — importa `doc`, `setDoc`, `addDoc` y
  `Timestamp` de `firebase/firestore`. Es donde aterriza la escritura de
  `allDay`.
- `apps/web/src/lib/types.ts` — `import type { Timestamp }`, sólo tipo.

Y `apps/web/src/events/events-view.ts`, si el orden de la rejilla se resolviera
ahí; con la decisión 7 no hace falta tocarlo.

Propuesta: **el editor se migra tras su puerto en esta feature**, como tarea
propia y anterior a la del campo `allDay`, porque es la que hace testable el
guardado sin emuladores — y el guardado es justo donde vive la normalización de
la decisión 5, que es la parte con más filo. `lib/types.ts` se queda como está:
su acoplamiento es un `import type` y lo resuelven T36–T38, no esta feature.

El tope de `arch/boundary.test.ts` baja de 23 a 22 ficheros acoplados. Si se
decide no migrar, hay que **decirlo en el plan** y no dejarlo pasar en silencio:
el precedente medido está en `AGENTS.md` —`sharing/` pasó de 16 a 20 ficheros
acoplados en unas horas por saltarse esto—.

## Comandos

Los del repo, sin añadidos (ver `AGENTS.md`):

```bash
npm run dev          # http://localhost:3000
npm test             # Vitest en Chromium, con TZ=America/Santiago
npm run test:rules   # reglas de Firestore contra el emulador
npm run test:arch    # frontera de capas, en Node
npm run test:e2e     # Playwright + axe
npm run typecheck
npm run lint
npm run lint:lit
npm run localize:extract && npm run localize:build
npm run emulators    # necesita Java 21+ en el PATH
npm run seed
```

`npm test` corre con `TZ=America/Santiago` a propósito, y para esta feature es
la variable más importante del repo: en Santiago hay días en que **la medianoche
no existe** porque el reloj salta de 00:00 a 01:00. Es lo que ya rompió la
detección ingenua de día completo, y es lo que la normalización de la decisión 5
tiene que sobrevivir.

## Estructura

Nada nuevo. Los ficheros que cambian:

```
apps/web/src/domain/format-dates.ts        toInputTime, formatEventDates(allDay)
apps/web/src/domain/build-ics.ts           fuera isStartOfDay; calendarWindow lee allDay
apps/web/src/domain/sort-events.ts         activeUntil respeta el día completo
apps/web/src/lib/types.ts                  campo allDay
apps/web/src/events/event-editor.ts        cuatro campos, normalización, puerto
apps/web/src/events/event-filters.ts       hora en el rango
apps/web/src/calendar/month-grid.ts        orden y hora en la celda
apps/web/src/application/ + infrastructure/  puerto del editor
firestore.rules                            allDay en hasOnly
apps/web/rules/firestore.test.ts           aserciones nuevas
apps/web/xliff/es.xlf                      textos nuevos
scripts/seed-emulator.js                   eventos con hora
docs/adr/0010-…                            la decisión de allDay y la zona horaria
                                            (0008 ya lo ocupaba otro ADR; ver T55)
```

`domain/google-calendar-url.ts` no se toca: lee `calendarWindow()` y hereda el
arreglo. Es la prueba de que la abstracción estaba en el sitio correcto.

## Estilo

El del repo: comentarios en español explicando **por qué**, no qué; mensajes de
commit en inglés; identificadores en inglés; todo texto visible dentro de
`msg()`.

Y una regla que esta feature va a tentar: **los mensajes que viven fuera de un
componente se construyen en fábricas**, porque `msg()` se evalúa al llamarlo.
`formatEventDates` ya lo cumple —formatea al invocarse—; cualquier constante de
formato nueva tiene que hacer lo mismo.

## Estrategia de tests

Unitarios junto al fuente, en Chromium real:

| Fichero | Qué prueba |
| --- | --- |
| `format-dates.test.ts` | `toInputTime` en los tres casos; las ocho combinaciones de `formatEventDates`; que el mismo día no repite fecha |
| `build-ics.test.ts` | `allDay: true` → `VALUE=DATE`; `allDay: false` a las 00:00 → `DTSTART` con hora; el fin exclusivo sigue siendo el día siguiente; un evento sin `allDay` se lee como día completo |
| `google-calendar-url.test.ts` | los dos formatos de `dates`, decididos por el campo |
| `sort-events.test.ts` | un evento de día completo **de hoy** está en «próximos» a las 23:59; uno con hora que acabó hace una hora está en «pasados» |
| `month-grid.test.ts` | dos eventos del mismo día salen ordenados por hora, y al revés con el orden invertido |
| `filter-events.test.ts` | un rango de 19:00 a 20:00 coge la cena de las 19:30 y no la de las 21:00 |
| `event-editor.test.ts` | escribir hora pone `allDay: false`; borrarla lo devuelve a `true`; con `allDay: true` las fechas se guardan al comienzo del día local |
| `generate-event.test.ts` | `toDate('2026-07-04T21:00')` conserva las 21:00 y el editor la muestra |

Reglas, contra el emulador: `apps/web/rules/firestore.test.ts`, las aserciones
de arriba.

E2e con Playwright y axe:

- `events.spec.ts` — crear un evento con hora, reabrirlo y que la hora esté;
  crear uno sin hora y que no aparezca ninguna.
- `views.spec.ts` — la hora visible en la rejilla del mes y en la agenda.
- `calendar-export.spec.ts` — el `.ics` descargado lleva `DTSTART:` con hora.
- `ai.spec.ts` — una imagen con hora llega al editor con la hora puesta.

Tres cosas que **este spec da por no verificables por un agente**, siguiendo
`AGENTS.md`:

1. **Abrir el `.ics` con hora en Google Calendar y en Apple Calendar** y
   comprobar que la hora es la correcta, no desplazada. Es la única prueba real
   de que el `Z` de `toIcsDateTime` se interpreta como esperamos.
2. La revisión humana de `firestore.rules`.
3. Cualquier cosa que dependa de `firebase.json`.

Y la regla que hace que estos tests valgan algo: **antes de dar por bueno
cualquiera de ellos, rómpelo a propósito.** Devolver `allDay` cableado a `true`
tiene que poner en rojo `build-ics.test.ts`; quitar el `sortEvents` de
`buildMonthGrid` tiene que poner en rojo `month-grid.test.ts`. Hay precedente en
este repo de dos e2e que pasaban igual con la regresión puesta.

## Criterios de éxito

Cerrados a 22/08/2026. Evidencia completa, tarea por tarea, en
[`tasks/todo.md`](../tasks/todo.md) (T44–T55 y sus checkpoints I–IV).

- [x] Crear «Cena, 4 jul 19:30–23:00», reabrir el editor y ver `19:30` y
      `23:00` en sus campos. Verificado dos veces: `events.spec.ts` en CI y,
      a mano, con Chrome DevTools contra `npm run dev` real (ver Checkpoint
      II en `todo.md`).
- [x] La tarjeta dice «4 jul 2026, 19:30 – 23:00», sin repetir la fecha.
      Mismo par de verificaciones que el criterio anterior.
- [x] Crear «Vacaciones, 1–15 ago» sin horas: ninguna hora en ninguna vista, y
      el `.ics` lleva `DTSTART;VALUE=DATE:20260801`. `calendar-export.spec.ts`
      («un evento de día completo sigue exportando VALUE=DATE»).
- [x] Un evento a las 00:00 con `allDay: false` exporta `DTSTART` con hora, no
      `VALUE=DATE`. Añadido durante la revisión de T54:
      `calendar-export.spec.ts` («un evento a las 00:00 con hora explícita
      exporta DTSTART con hora, no VALUE=DATE»).
- [x] Un evento de día completo que ocurre **hoy** aparece en «Próximos», no en
      «Pasados». `sort-events.test.ts` y `agenda-days.test.ts` (T47).
- [x] Dos eventos del mismo día salen ordenados por hora en la celda del mes.
      Verificado en CI (`month-grid.test.ts`, `calendar-view.test.ts`) y a
      mano con Chrome DevTools (celda del 10/09/2026 con «19:30 Cena de
      prueba»).
- [x] Un evento guardado antes de esta feature se sigue viendo, se sigue
      editando y se sigue exportando como de día completo. `types.test.ts`
      (`default(true)`), `build-ics.test.ts` («sin el campo allDay se lee
      como día completo»), y el e2e añadido en la revisión de T54
      (`events.spec.ts`, «un evento heredado sin el campo allDay se muestra
      como día completo», escribiendo el documento directo en el emulador
      para simular uno anterior a esta feature).
- [x] Filtrar de 19:00 a 20:00 devuelve la cena de las 19:30 y no la de las
      21:00. Verificado en CI (`views.spec.ts`) y a mano con Chrome DevTools
      (creadas «Cena de prueba» 19:30 y «Cena tardía» 21:00, filtro
      19:00–20:00, sólo queda la primera).
- [x] Una foto de un cartel con «21:00» llega al editor con `21:00`.
      `ai.spec.ts` («una imagen con hora llega al editor con la hora
      puesta»), verificado en CI — no repetido a mano, porque mockear
      `window.LanguageModel` no es práctico fuera de Playwright.
- [x] `npm test`, `test:rules`, `test:arch`, `test:e2e`, `typecheck`,
      `lint`, `lint:lit` salen en **0**, comprobando `$?` y no la salida.
      Job `verify` del run de CI de `main` a 22/08/2026 (SHA `eca962b`) en
      verde: 541 tests unitarios, tests de reglas y 72 e2e, todos pasando;
      `typecheck`, `lint` y `lint:lit` comprobados también en local con
      código de salida explícito.
- [x] El tope de `arch/boundary.test.ts` baja a 22, o el plan dice por qué
      no. No baja: subió a 27, y el porqué de cada salto —T31, T48 (dos
      veces) y T32— está documentado en el comentario del propio test y en
      el Checkpoint IV de `todo.md`.

## Límites

**Siempre:**

- Componentes locales para construir fechas; nunca `toISOString()`.
- Todo texto nuevo en `msg()`, con `localize:extract` y `localize:build` antes
  de commitear.
- Verificar por código de salida, no leyendo la salida.
- El cambio de la decisión 6 —día completo vigente hasta el final del día— en su
  propio commit.
- Al tocar un fichero de la lista de exenciones de `biome.json`, dejarlo tras su
  puerto o justificarlo en el plan.

**Preguntar antes:**

- Añadir cualquier campo al documento que no sea `allDay`.
- Tocar `changesContentOnly()` o la lista `hasAll` de las reglas.
- Añadir dependencias (`date-fns`, `luxon`, `temporal-polyfill`). `Intl` y
  `Date` bastan para lo que pide este spec.
- Subir el tope de ficheros acoplados de `arch/boundary.test.ts`.

**Nunca:**

- Poner `allDay` en `hasAll`: volvería ineditable todo evento anterior.
- Que el valor por defecto de `allDay` sea `false`.
- `biome check --write` a ciegas: hay autofixes «seguros» que borran los campos
  `@consume` del editor.
- Comentarios en `biome.json`.
- Marcar una casilla de `tasks/plan.md` sin la evidencia al lado.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| **Los eventos anteriores se convierten en citas de medianoche.** Es el fallo caro: afecta a todos los datos existentes y se ve en el calendario de cada invitado | `default(true)` en el esquema, y un test explícito de que un documento **sin** el campo se lee como día completo |
| La medianoche que no existe (Santiago, Cuba, Paraguay, Líbano) rompe la normalización a comienzo de día | `npm test` ya corre con `TZ=America/Santiago`; el caso lleva test desde `build-ics` |
| La hora se guarda pero se pinta desplazada por la zona | La zona del navegador es la decisión 3, con test de que el instante guardado es el que se eligió; la comprobación final es humana, abriendo el `.ics` |
| `formatEventDates` pasa de 4 a 8 ramas y alguna queda sin texto traducido | Test por rama, y `localize:extract` en el mismo commit |
| Migrar el editor tras su puerto crece más que la feature | Va como tarea propia y **primera**; si se desborda, se para y se decide, no se mezcla |

## Preguntas abiertas

1. **¿Zona horaria del evento?** Decidido fuera de alcance para esta feature. Se
   convierte en pregunta real el día que haya invitados en varias zonas, y
   entonces necesita ADR: campo `timeZone` IANA, `VTIMEZONE` en el `.ics` y una
   respuesta a «¿la hora de quién manda?». Hoy manda la del navegador de cada
   uno.
2. **¿Se muestra la zona en la interfaz?** Un «19:30 CEST» avisaría de la
   ambigüedad sin construir nada. Barato, pero es interfaz nueva y no está
   decidido.
3. **¿Un ADR o dos?** La bandera `allDay` y la política de zona horaria son dos
   decisiones. Propuesta: un solo ADR 0008 que cierre la primera y **registre**
   la segunda como no decidida, que es lo que hoy es.
4. **¿Hora por defecto al escribir la primera?** Un `wa-input type="time"` vacío
   obliga a teclear la hora entera. Poner «09:00» al vuelo ahorra pulsaciones y
   arriesga guardar una hora que nadie eligió — el mismo razonamiento por el que
   `generate-event.ts` prefiere un campo vacío a uno relleno con un año
   inventado. Propuesta: vacío.
