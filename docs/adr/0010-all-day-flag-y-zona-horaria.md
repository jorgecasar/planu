# 0010 · Bandera `allDay` explícita, zona horaria pendiente

- **Estado:** aceptado
- **Fecha:** 2026-08-22

## Contexto

Hasta esta feature un evento sólo tenía fechas, nunca hora: `startDate` y
`endDate` se guardaban a medianoche local y ninguna vista tenía por qué
distinguir «este evento dura todo el día» de «esta cita empieza justo a las
00:00». La distinción sólo importa el día en que la hora entra en el modelo, y
ese día es hoy — ver [`docs/spec-horas-en-eventos.md`](../spec-horas-en-eventos.md).

Antes de tener un campo explícito, la única forma de saber si un evento era de
día completo era comprobar que sus fechas cayeran en el comienzo de su día
local. Esa heurística —`isStartOfDay()` en `domain/build-ics.ts`— tenía un
defecto de fondo: no distinguía un evento de día completo de una cita real a
medianoche. Con hora en el modelo, ese defecto deja de ser tolerable: una cita
a las 00:00 es un caso legítimo (duración cero o fin abierto, ver más abajo) y
merece exportarse con hora, no como día completo por casualidad de reloj.

## Decisión

### Una bandera `allDay` por evento, no por extremo

```ts
// lib/types.ts
allDay: z.boolean().default(true),
```

Es del evento entero, no de cada fecha. No existe «inicio con hora y fin sin
hora»: escribir cualquiera de las dos horas en el editor pone `allDay: false`;
borrar las dos lo devuelve a `true`. Un evento con `allDay: false` y una sola
hora es legítimo —significa duración cero o fin abierto, que el modelo ya
admite—, pero la bandera sigue siendo del evento, no de cada extremo.

El motivo es RFC 5545: un `VEVENT` no puede mezclar `DTSTART;VALUE=DATE` con un
`DTEND` que lleve hora. Un modelo con dos banderas independientes produciría
datos que el `.ics` no podría representar sin inventar una de las dos.

### `default(true)`, no `false`

Todo evento escrito antes de esta feature carece del campo, y todos ellos son
de día completo —el editor los guardó a medianoche—. Con `false` por defecto,
cada evento existente se convertiría en una cita puntual de duración cero en
el `.ics` y en el listado, en el mismo instante en que se desplegara este
cambio. Es la migración implícita: un documento sin el campo se lee, se edita
y se exporta como día completo, sin backfill.

Se verificó con test explícito en cuatro capas —esquema (`types.test.ts`),
exportación (`build-ics.test.ts`), reglas (`firestore.rules` + su test) y
lectura del listado (`events-view.ts`)— porque **la lectura del listado fue
justo donde el defecto apareció de verdad**: `toEvent()` no enumeraba
`document.allDay` antes de pasar el objeto a `eventSchema().safeParse()`,
así que `default(true)` rellenaba el hueco para todo evento, guardado con hora
o sin ella. El camino de escritura era correcto desde el principio; sólo la
lectura perdía el campo, y ningún test unitario lo detectó porque cada uno
prueba un lado del viaje de ida y vuelta por separado. Lo encontró el primer
e2e que guardaba y volvía a leer un evento con hora.

### De día completo, las fechas se normalizan al comienzo del día local

Al guardar con `allDay: true`, `startDate` y `endDate` se recolocan a
`new Date(año, mes, día)`. Un evento de día completo no debe arrastrar una
hora residual de cuando la tuvo —de si alguna vez tuvo hora y se le quitó—, y
así `toIcsDate()` puede seguir leyendo componentes locales sin tener que mirar
también la bandera para saber si ignorar la hora.

### `activeUntil` respeta el día completo

Antes de esta feature, `activeUntil()` (`domain/sort-events.ts`) devolvía
`endDate` tal cual, que para un evento de día completo es medianoche. A las
00:01 el evento ya pasaba a «pasado», así que un evento de día completo que
ocurre hoy aparecía archivado durante el resto del día en que en realidad
sucede. Con `allDay` explícito se corrige: de día completo, el instante que
cierra el evento es el final de ese día local (23:59:59.999), no su comienzo.
Sólo se podía arreglar desde que existe la bandera —antes no había forma de
distinguir el defecto de un evento con hora real a medianoche—, y por eso
llega con esta feature y no antes.

## Zona horaria: registrada como no decidida

Se guarda el instante (`Timestamp`) y se pinta en la zona del navegador de
quien mira, exactamente igual que antes de esta feature. Un evento a las 19:30
en Madrid se ve a las 13:30 en Bogotá. Es correcto para una reunión remota y
confuso para una cena presencial con invitados en zonas distintas; se acepta a
sabiendas porque **hoy no hay usuarios en varias zonas** y el coste de
resolverlo bien es desproporcionado para un problema que no existe todavía.

Esto no es una decisión tomada, es una decisión **pospuesta y registrada**.
Se convierte en pregunta real el día que haya invitados en zonas distintas
compartiendo un evento, y entonces exige su propio ADR con al menos:

- Un campo `timeZone` IANA en el modelo.
- Emitir `VTIMEZONE` en el `.ics` en vez de horas en UTC sueltas.
- Una respuesta a «¿la hora de quién manda?» — hoy manda la del navegador de
  cada uno, sin que nadie lo haya decidido así a propósito.
- Si se muestra la zona en la interfaz («19:30 CEST») para avisar de la
  ambigüedad sin resolverla del todo. Barato de añadir, pero es interfaz nueva
  y tampoco está decidido.

## Consecuencias

- **Un evento sin `allDay` se trata como día completo en todas las capas**:
  esquema, exportación, reglas de Firestore y ordenación. Es la migración
  implícita, y su ausencia de backfill es la decisión, no un descuido.
- **`isStartOfDay()` desaparece.** La heurística que confundía día completo
  con cita a medianoche ya no hace falta: `calendarWindow()` lee el campo
  directamente.
- **`firestore.rules` valida el tipo cuando el campo está presente**
  (`d.allDay is bool`) pero no lo exige (`allDay` en `hasOnly`, no en
  `hasAll`), por el mismo motivo que `tags`: exigirlo dejaría inservibles
  todos los documentos anteriores.
- **La zona horaria queda como deuda documentada, no como olvido.** El día que
  se retome, este ADR es el punto de partida y no hay que redescubrir por qué
  se aplazó.
- **`scripts/seed-emulator.js` siembra con al menos tres eventos con hora
  real**, para que la migración implícita y el caso con hora se puedan probar
  a mano desde el primer arranque tras sembrar.
