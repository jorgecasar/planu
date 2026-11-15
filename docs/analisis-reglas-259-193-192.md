# Análisis de las issues abiertas #259, #193 y #192 (reglas de compartir)

- **Fecha:** 2026-11-15 · **Estado:** análisis, sin cambios de código ni de `firestore.rules`
- **Base:** `origin/main` en `e195080`. Las rutas y líneas son de ese commit.
- **Lee:** ADR [0012](adr/0012-invitaciones-pendientes-por-email.md), [0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md), [0014](adr/0014-ofertas-por-email-se-gastan-al-unirse.md) y [0015](adr/0015-lapida-al-salir-de-un-evento.md); `firestore.rules`; `apps/web/src/sharing/`; `apps/web/src/infrastructure/firebase/`; los tests de `apps/web/rules/`.
- **Restricciones que se respetan:** sin servidor (ni Cloud Functions ni Blaze), `TOPE_ACOPLADOS = 24` no sube, un único `allow` por operación (las alternativas se combinan con `||` dentro de él).

## Qué se verificó y qué no

- **Verificado leyendo código:** todo lo que lleva fichero y línea.
- **No ejecutado:** los tests de reglas (`npm run test:rules`). Necesitan el emulador de Firestore en `:8080`. Ese puerto, el `:4000` y otros del emulador están ocupados ahora mismo por otra sesión. El worktree no tiene `node_modules`. Arrancar o parar emuladores habría interferido con esa sesión, así que no se hizo.
- Todo lo marcado **«verificar»** es un comportamiento de las reglas deducido de leerlas. Hay que confirmarlo con un test contra el emulador antes de implementar.
- **Datos de producción:** no se han mirado. Los puntos que dependen de ellos van como «verificar en producción».

## Mapa de lo relevante

| Pieza | Dónde |
|---|---|
| Lectura de `eventInvites` (permite `resource == null`) | `firestore.rules:530-533` |
| Borrado de `eventInvites` (dueño verificado en cualquier estado; invitado salvo lápida con evento vivo) | `firestore.rules:539-543` |
| Lápida (`writesTombstone`, id atado con `_`) | `firestore.rules:472-491` (id en `:480`) |
| Volver a invitar (`ownerReoffers`, también desde `removed`) | `firestore.rules:430-441` |
| Borrado del evento (sin verificación) | `firestore.rules:316` |
| Salir y expulsar con lápida | `leavesTheEvent` `:145-156`, `removesWithTombstone` `:162-168` |
| Lectura de ofertas por email: `get` solo con id propio, `list` solo remitente | `firestore.rules:589-602` |
| Creación de eventos: no impone nada sobre el id | `firestore.rules:284-290` |
| Cancelar una invitación = `deleteDoc` | `sharing-adapter.ts:230-232`, usado en `share-dialog.ts:351-364` |
| Volver a invitar = `getDoc` + `emailOfferTo` + `batch.set` | `sharing-adapter.ts:165-195` |
| Borrar un evento desde la interfaz | `event-card.ts:492` → `event-repository.ts:79-81` (solo `deleteDoc`) |
| Borrado de cuenta: recibidas, saltándose lápidas | `account-data-adapter.ts:192-216` |
| Borrado de cuenta: enviadas (solo si verificada) | `account-data-adapter.ts:218-232` |

---

## Issue #259: oráculo de existencia en `eventInvites` e ids con guion bajo

### Qué dice

1. La rama `resource == null` del `allow read` deja a cualquier usuario con sesión (incluso sin verificar) distinguir «no existe» (permitido) de «existe y es de otros» (denegado). El comentario de las reglas dice que la respuesta es la misma para todos, y no lo es. Con las lápidas se puede inferir además que el uid U salió o fue expulsado del evento E.
2. `writesTombstone` ata el id a `eventId + '_' + inviteeUid`. Con ids que contengan `_`, dos pares distintos podrían dar el mismo id.

### Qué es cierto según el código

**Punto 1: cierto.**

- `firestore.rules:530-533` permite `get` con `resource == null` a cualquier `request.auth != null`, sin `isVerified()`.
- El comentario de `:524-529` («the same answer for every signed-in reader») es falso para ese mismo documento. Si existe y no es tuyo, la lectura se deniega.
- Es el único sitio de la base de reglas que lo hace así. `eventInvitesByEmail` ya resolvió el mismo problema con `isOwnMissingId()` (`:589-596`, ADR 0012).
- Quien lee el id inexistente en el cliente es solo `inviteToEvent`: `sharing-adapter.ts:171`, el `getDoc(ref)` previo. Es lo que mantiene viva la rama.

**Lo que se aprende.** La existencia del documento `E_U` no distingue estado: vale para pendiente, aceptada, rechazada o lápida. Se aprende «U tiene o tuvo relación con E». Combinado con quién es miembro (que un miembro ya ve), un miembro deduce quién rechazó, salió o fue expulsado.

**Punto 2: la premisa de la issue es incompleta, y el riesgo real es menor.**

- Un id es `E + '_' + U`. Si el uid no contiene `_`, el último `_` del id separa siempre el uid, así que el par `(E, U)` se recupera sin ambigüedad aunque `E` contenga `_`.
- La invariante que importa es que **ningún uid contenga `_`**. Que los eventId no lo contengan no hace falta.
- Los uids de Firebase Auth con correo, Google o anónimo son alfanuméricos (28 caracteres). Solo podrían llevar `_` uids personalizados creados con el Admin SDK, y el proyecto no tiene servidor.
- Las reglas **no** comprueban que `inviteeUid` sea un uid real: solo `is string` y `size() <= 128` (`:343`). El dueño puede escribir un `inviteeUid` inventado con `_` en las invitaciones de su propio evento (`eventOf(d).userId == uid()`, `:500`).
- Las reglas **no** limitan el id de un evento: `allow create` de `events` (`:284-290`) no mira `eventId`. Un cliente hostil puede hacer `setDoc` con un id con `_`. `addDoc` genera 20 caracteres alfanuméricos.
- `acceptsInvite` ya se defiende: relee `inviteeUid` y `eventId` del documento (`firestore.rules:118-122`).

### Riesgo real y quién puede explotarlo

| Hallazgo | Explotable | Quién y qué necesita | Daño |
|---|---|---|---|
| Oráculo (1) | **Sí, pero marginal** | Cualquier cuenta con sesión que conozca `eventId` y `uid`. El `eventId` lo conocen miembros, invitados, y quien lo vio en una URL o en un enlace. Un expulsado conserva el `eventId` que conocía. | Saber si U salió, fue expulsado o rechazó en E. No hay email ni contenido. Son datos de comportamiento seudónimos. |
| Colisión de ids (2) con ids y uids honestos | **No** | Haría falta un uid con `_`. No existe con los proveedores actuales. | Ninguno. |
| Colisión (2) con ids hostiles | **Teórico y sin víctima** | Un dueño que cree eventos con `_` y uids inventados con `_` solo choca con documentos de sus propios eventos. Los updates conservan `eventId`, `inviteeUid` e `invitedBy` (`:430-441`), así que no cambia quién es el titular. | Un documento mal atribuido entre dos eventos del propio atacante. |

El «no explotable» del punto 2 depende de un dato que no se ha mirado: «verificar en producción» que ningún uid de Auth tenga `_` (exportación de usuarios de Auth). Para los eventId no hace falta.

### Opciones y coste

**Punto 1 (oráculo)**

| Opción | Qué hace | Coste | Cierra |
|---|---|---|---|
| A0. Corregir el comentario | Dice la verdad: la respuesta depende de si existe | Trivial, sin riesgo | No cierra nada, documenta |
| A1. Exigir `isVerified()` en la rama `resource == null` | Quita a las cuentas sin verificar | 1 línea de reglas + 1 test | Poco: registrar y verificar un correo cuesta nada |
| A2. Que el dueño lea por consulta y quitar `resource == null` | `inviteToEvent` pasa de `getDoc` a un `getDocs(query(invitedBy ==, eventId ==, inviteeUid ==))`, como ya hace `emailOfferTo` (`sharing-adapter.ts:75-90`). Un `get` sobre un id inexistente se deniega para todos | Cambio en el adaptador y en sus tests; reglas: borrar una cláusula; revisar los tests de reglas que dan por bueno leer un id inexistente. Las consultas con solo igualdades no piden índice compuesto (verificar) | **Cierra del todo** |
| A3. Solo reglas: leer un inexistente solo si eres el dueño del evento del id (`get(events/$(inviteId.split('_')[0])).data.userId == uid()`) | Sin tocar el cliente | Una lectura facturada más por consulta. Depende de que el eventId no lleve `_`, o sea del punto 2 | Cierra para todos salvo el dueño, que ya lo sabe |

**Punto 2 (guion bajo)**

| Opción | Coste | Notas |
|---|---|---|
| B1. No hacer nada y documentar la invariante «el uid no lleva `_`» en el ADR | Mínimo | La invariante real es sobre el uid. Mantener la comprobación de producción |
| B2. En reglas, `!eventId.matches('.*_.*')` al crear eventos y `!d.inviteeUid.matches('.*_.*')` en `isValidInvite` y en `writesTombstone` | Dos o tres líneas de reglas + tests. No afecta a los datos existentes (solo escrituras) | Cierra la ambigüedad estructuralmente. El segundo filtro importa más que el primero |
| B3. Cambiar el separador | Migrar todos los documentos y clientes en caliente | **Descartada**: coste alto, sin beneficio |

### Recomendación

Hacer **A2 + A0 + B2 (solo el filtro de `inviteeUid`)**. En una sola PR de reglas, que revisa una persona:

- Se cierra el oráculo y el comentario deja de mentir.
- La invariante del uid queda impuesta por las reglas, no supuesta.
- El filtro del eventId es opcional. Con el del uid basta, y el del eventId solo añade defensa en profundidad.

Si se prefiere no tocar el cliente ahora, A3 es la alternativa solo de reglas. Si se acepta el residual, A0 basta, y en ese caso conviene mover la issue a «aceptado» y quitarle la etiqueta de pendiente.

### Qué verificar antes de implementar

- Un test de reglas, hoy ausente, que pruebe la asimetría: un `get` ajeno sobre un id inexistente tiene éxito y sobre uno existente falla. Es lo que fundamenta el cierre.
- Que la consulta de `inviteToEvent` en A2 no exija índice compuesto y que la regla de lectura la acepte (el `||` entre `inviteeUid` e `invitedBy`). Es el mismo patrón de `listPendingInvites`, que ya funciona.
- Que ninguna prueba de reglas existente dependa de leer un inexistente.
- «Verificar en producción»: uids de Auth sin `_`.

### Decisión que necesita del responsable (seguridad)

1. ¿Se cierra el oráculo (A2) o se acepta y se corrige solo el comentario (A0)?
2. ¿Se impone en reglas que el `inviteeUid` no lleve `_` (B2)?

---

## Issue #193: borrar las lápidas y ofertas al borrar el evento

### Qué dice

Borrar un evento no borra sus lápidas. Siguen ahí con el uid seudónimo hasta que el dueño borra su cuenta, contra la minimización del ADR 0013. Los criterios: que borrar el evento borre sus `eventInvites` (lápidas incluidas) y sus ofertas pendientes de `eventInvitesByEmail`; que el borrado de cuenta borre las lápidas que ahora se salta cuando el evento ya no existe; y una nota nueva en el ADR 0015.

### Qué es cierto según el código

- **Cierto, y más amplio de lo que dice la issue.** `EventRepository.delete` solo hace `deleteDoc(events/{id})` (`event-repository.ts:79-81`), que es lo que llama la tarjeta (`event-card.ts:492`). Nada borra invitaciones ni ofertas.
- **Lo que queda es peor que una lápida seudónima.**
  - Las ofertas de `eventInvitesByEmail` guardan `inviteeEmail` **en claro**, de personas que quizá nunca se registren (`firestore.rules:~565-570`, `isValidOffer`).
  - Las invitaciones pendientes, aceptadas y rechazadas guardan `inviteeEmail` (opcional), `eventTitle` e `invitedByName`.
  - Todo eso se retiene hasta que el dueño borra su cuenta, y **solo si su cuenta sigue verificada** (`deleteSentInvitations`, ADR 0013: «con la verificación revocada quedan las enviadas»).
- **Las reglas ya lo permiten.**
  - El dueño verificado borra cualquier invitación suya (`:540`), sin mirar si el evento existe.
  - El remitente lista y borra sus ofertas (`isSender`, `:551-555`, `:602`, `:624`).
  - El invitado borra su lápida cuando el evento ya no existe (`:541-543`). Hay un test del lado del invitado (`stale-email-offer.test.ts:322`) y ninguno del lado del dueño.
- **Por qué el cliente no puede esperar la lápida del invitado en el borrado de cuenta.** `deleteReceivedInvitations` se salta toda lápida (`account-data-adapter.ts:205-213`). El motivo (ADR 0015) es que un invitado no puede saber si el evento existe: no es miembro y la lectura de `events` exige serlo (`firestore.rules:274`), así que la lectura se deniega exista o no. Un intento de borrado denegado hacía fallar todo el borrado de cuenta.
- **Efecto secundario a verificar.** Una invitación pendiente de un evento ya borrado debería seguir saliendo en la bandeja de quien la recibe (`watchReceivedInvites`, consulta por `status == pending`). Aceptarla fallaría. Es plausible, falta confirmarlo.
- **Acoplamiento.** `event-repository.ts` ya importa Firestore y está en la lista de `TOPE_ACOPLADOS`. Si la limpieza vive ahí, no hay ficheros nuevos que importen `firebase/*`, y el tope no sube (verificar con `npm run test:arch`).

### Riesgo real y quién puede explotarlo

No es una vulnerabilidad: es retención de datos personales.

- **Quién se ve afectado:** terceros invitados por correo, sin cuenta, cuyo email queda en claro en una oferta de un evento que ya no existe. Los uids seudónimos de quien salió o fue expulsado son el caso menor.
- **Quién lo explota:** nadie activamente. El dueño y el invitado ya tenían acceso a sus propios datos. Con acceso a la base, el dato está ahí.
- **Gravedad:** baja en seguridad, pero **media en privacidad (RGPD, minimización)**. Mientras no haya usuarios reales es solo deuda. Después del lanzamiento deja de serlo.

### Opciones y coste

**Dónde borrar al borrar el evento**

| Opción | Qué hace | Coste |
|---|---|---|
| A. Después de `deleteDoc(event)`, limpieza best-effort en el cliente | El dueño consulta `eventInvites` (`invitedBy ==`, `eventId ==`) y `eventInvitesByEmail` (mismo filtro) y borra en lotes de 450, atrapando los fallos | Cambio en `event-repository.ts` (+ firma de `delete` y puerto: hace falta el uid del dueño para las consultas, que las reglas obligan a filtrar), tests unitarios. **Sin cambios de reglas.** |
| B. Antes del evento, en el mismo lote | Atómico | **No sirve**: el borrado del evento no se puede condicionar a la verificación (`:316`, «an unverified owner must still be able to erase their data»), y el de las invitaciones sí. Si el dueño no está verificado, el lote entero fallaría y no podría borrar el evento. |
| C. Sin servidor no hay otra vía fiable | — | Una Cloud Function sería lo natural, pero queda fuera |

**Qué pasa si la limpieza falla o se interrumpe**: quedan huérfanos, igual que hoy, y el borrado de cuenta los recoge si la cuenta está verificada. Es un cierre parcial, no total. Debe quedar escrito en el ADR.

**Borrado de cuenta del invitado (criterio 2)**

| Opción | Coste |
|---|---|
| D1. Intentar borrar la lápida y tolerar la denegación (`permission-denied`) | Cambio en `deleteReceivedInvitations` (ya re-lee tras un fallo). Riesgo: es lo que el e2e de T32 sufrió. Hay que **verificar** con el emulador que el borrado denegado de una sola lápida no rompe el resto |
| D2. No tocarlo y aceptar que el invitado deja la lápida cuando el evento sigue vivo (hoy) | Ninguno. Cuando el evento ya no exista, la lápida cae con la limpieza del dueño (opción A) o con su cuenta |

### Recomendación

1. **Opción A** (limpieza del dueño, best-effort, tras borrar el evento), incluyendo `eventInvitesByEmail` y todos los estados de `eventInvites`, no solo lápidas. Sin tocar reglas.
2. **D1 con prueba**: intentar el borrado y tolerar `permission-denied` solo para lápidas, con test unitario y el e2e de T32 pasando.
3. Añadir un test de reglas del lado del dueño (hoy falta): el dueño verificado borra las invitaciones de un evento ya borrado, y el no verificado no.
4. Nota nueva en el ADR 0015 (o un ADR corto que lo complemente), sin reescribir el aceptado: la retención se acorta al borrar el evento, y lo que queda es el caso de limpieza interrumpida o dueño sin verificar.
5. Confirmar con el e2e de «borrar un evento compartido» que sigue pasando.

### Qué no se pudo verificar

- Que el borrado denegado de una lápida no hace fallar el flujo de borrado de cuenta (requiere emulador y el e2e de T32).
- Que la bandeja del invitado muestra invitaciones de eventos borrados.
- El impacto en `test:arch` de cambiar la firma del puerto `EventRepositoryPort.delete` (`application/ports/event-repository.ts:43`).

### Decisión que necesita del responsable (producto/privacidad)

1. ¿Basta una limpieza best-effort del cliente (cierre parcial) o hay que esperar a tener servidor para cerrarlo del todo? Con el lanzamiento próximo se recomienda lo primero.
2. ¿Qué plazo de retención se acepta para las ofertas por email (que no caducan, `:549`, «retention is undecided»)? Esta issue lo agrava y no lo decide. Sin caducidad, una oferta sin reclamar no se borra nunca.

---

## Issue #192: riesgos residuales del ADR 0015 al volver a invitar

### Qué dice

Dos riesgos bajos, ambos dependientes de una acción del dueño:

- **(c′)** El dueño vuelve a invitar por uid a alguien que expulsó y cancela esa invitación. Cancelar borra el documento y con él la lápida, así que una oferta antigua por email deja volver a entrar a esa persona.
- **(c)** Quien fue readmitido por uid borra esa invitación pendiente y reclama una oferta por email más antigua. Entra con el rol de esa oferta.

Criterios: que el diálogo muestre y deje retirar las ofertas por email pendientes al volver a invitar, y decidir y documentar si cancelar una invitación que viene de una lápida debe restaurar la lápida.

### Qué es cierto según el código

- **El mecanismo es como se describe.**
  - Volver a invitar escribe sobre la lápida con `ownerReoffers` (`firestore.rules:430-441`, permite `removed → pending`).
  - Cancelar es un `deleteDoc` (`sharing-adapter.ts:230-232`), y la regla de borrado del dueño no mira el estado (`:540`).
  - Reclamar una oferta es un `create` en `eventInvites` (`claimsOffer`, `:454-466`) y falla mientras el id esté ocupado (`:493-505`). Sin documento, el id queda libre.
- **Ya hay una mitigación parcial que la issue no menciona.** `inviteToEvent` borra en el mismo lote la oferta por email a la **dirección escrita en el diálogo** (`sharing-adapter.ts:165-195`, ADR 0014). (c) y (c′) solo ocurren con una oferta a **otra dirección** de la misma persona (un cambio de correo, o una segunda dirección). Quedan además las ofertas que el dueño cree después de volver a invitar.
- **El diálogo no muestra las ofertas por email.** `listPendingInvites` consulta solo `eventInvites` (`sharing-adapter.ts:135-160`, usado en `access-list.ts:131`). No hay ningún método de listado de ofertas en el puerto de compartir (`application/ports/sharing.ts`). La regla ya permite al remitente listarlas (`firestore.rules:602`).
- **La afirmación «una lápida cancelada sería imposible de borrar» no es cierta a nivel de reglas.** El dueño verificado puede borrar cualquier invitación suya, lápida incluida (`:540`; ADR 0015: «El dueño puede borrar la lápida»). Lo que no hay es una acción en la interfaz. Confirmarlo con un test (hoy no existe para `removed`).
- **(c) no se puede cerrar con reglas sin memoria.** Cuando el invitado borra su invitación pendiente el documento desaparece, y las reglas no ven registros borrados (ADR 0014, contexto). Solo se evitaría impidiendo que el invitado borre su pendiente, lo que choca con el RGPD (ADR 0013) y con el borrado de cuenta.

### Riesgo real y quién puede explotarlo

- **Quién:** la persona expulsada y readmitida (c) o expulsada y readmitida y cancelada (c′), con una oferta por email vigente a otra dirección suya.
- **Qué necesita:** que el dueño haya dejado esa oferta viva y no la haya retirado. Es una condición doble: una acción previa del dueño más un descuido.
- **Daño:** entrada al evento con el rol de la oferta, no con el que el dueño eligió al readmitir. En (c′) vuelve a entrar quien el dueño decidió no readmitir.
- **Explotable hoy:** sí, pero solo con un cómplice que sea el propio dueño (un descuido). **No es explotable por un tercero sin la colaboración del dueño.** Con cero usuarios reales es teórico, y la issue ya lo acepta hasta el lanzamiento.

### Opciones y coste

| Opción | Qué hace | Cierra | Coste |
|---|---|---|---|
| A. Mostrar y retirar las ofertas por email pendientes del evento en el diálogo | Nuevo `listPendingOffers(eventId, invitedBy)` en `SharingPort` (consulta con filtros, la regla `:602` ya lo permite), una sección en el diálogo y borrado de oferta | La causa común de (c) y (c′): el dueño ve y retira la oferta. No depende de reglas | Puerto + adaptador + diálogo + tests unitarios. **Sin reglas.** Cuidado con `TOPE_ACOPLADOS`: el diálogo no debe importar Firebase. Se añade al puerto, no al diálogo |
| B. Restaurar la lápida al cancelar | Las reglas añaden `ownerWithdraws()` dentro del único `allow update` (`pending → removed`, forma de lápida). Para no dejar lápidas de primeras invitaciones canceladas, un campo opcional (p. ej. `readmitted: true`) que escribe `ownerReoffers` al venir de `removed`, y solo con él se permite restaurar | (c′) | Reglas + `isValidInvite` (nuevo campo) + cliente (`revokeInvite` decide entre borrar y restaurar, `listPendingInvites` devuelve la marca) + tests. **Toca reglas: lo revisa una persona.** No cierra (c) |
| C. Aceptar y documentar | Nota en el ADR | Nada | Mínimo |
| D. Impedir al invitado borrar su pendiente readmitida | — | (c) | **Descartada**: contra ADR 0013/RGPD y rompe el borrado de cuenta |

**Sobre «restaurar la lápida».** La alternativa sin marca (restaurar siempre) deja una lápida cada vez que se cancela una primera invitación, lo que bloquea sin motivo las ofertas por email a esa persona y suma una retención más. Con la marca se evita, a cambio de un campo nuevo en el modelo. En ninguno de los dos casos queda una lápida «imposible de borrar»: el dueño puede borrarla por reglas.

### Recomendación

1. **Hacer A** (es el primer criterio de aceptación de la issue). Es la mitigación con mejor relación coste/beneficio, no toca reglas y cierra la causa raíz que comparten (c) y (c′): la oferta olvidada.
2. **Decidir B en el responsable**, con esta recomendación: **no hacerlo ahora**; documentar en el ADR 0015 que (c′) queda cubierto por A (el dueño ve y retira ofertas antes o después de cancelar) y que B se reabre si hay usuarios reales y se detecta el caso. Es más cambio de reglas del que justifica un riesgo que exige un descuido del dueño.
3. **(c) se acepta y se documenta**: no hay solución con reglas sin memoria, y el dueño consintió la vuelta. Solo se desconoce el rol.
4. Pasar los escenarios (c) y (c′) de `scratchpad/t5b/audit2.js` a tests de reglas: **no se ha podido hacer** porque el script no está en el repo (la ruta `scratchpad/` no existe en `origin/main`). Pedir el fichero o reescribir los dos escenarios.

### Qué no se pudo verificar

- Los escenarios (c) y (c′) contra el emulador (no se ejecutó) ni el script de la auditoría.
- Que el dueño borra una lápida: es lectura de reglas, sin test en el repo para `removed`.
- Que una consulta de ofertas del remitente filtrada solo por `invitedBy` y `eventId` pase la regla de `list` (ya la usa `emailOfferTo`, así que es lo esperable).

### Decisión que necesita del responsable (producto/seguridad)

1. ¿A (mostrar y retirar ofertas) basta, o se quiere además B (restaurar la lápida)?
2. ¿Se acepta (c) como residual documentado, ya que no se puede cerrar sin servidor ni sin quitar al invitado el derecho a borrar su pendiente?
3. ¿Se mantiene el compromiso «se revisa antes del lanzamiento»? Con A y la nota del ADR, sí.

---

## Resumen

| Issue | Es cierto | Riesgo real | Explotable por | Fix recomendado | Reglas | Coste | Decisión del responsable |
|---|---|---|---|---|---|---|---|
| #259 punto 1 (oráculo) | Sí (`:530-533`), el comentario es falso | Bajo: revela que U salió, rechazó o fue expulsado de E | Cualquier cuenta con sesión que conozca `eventId` y `uid` | A2: leer por consulta y quitar `resource == null`; corregir el comentario | **Sí** | Medio-bajo | ¿Cerrar (A2) o aceptar (A0)? |
| #259 punto 2 (ids con `_`) | Parcial: la invariante real es sobre el uid, no sobre el eventId | Nulo con uids honestos | Nadie, salvo un dueño contra sí mismo | B2: prohibir `_` en `inviteeUid` (y, si se quiere, en el id de evento) | **Sí** | Bajo | ¿Imponerlo en reglas? Verificar en producción que no hay uids con `_` |
| #193 (borrar al borrar el evento) | Sí, y más amplio: ofertas con email en claro | Privacidad media, seguridad baja | Nadie; retención | A: limpieza del dueño tras borrar el evento + D1 en el borrado de cuenta + nota en ADR 0015 | **No** (más un test de reglas) | Medio | ¿Cierre parcial best-effort? Plazo de retención de ofertas sin caducidad |
| #192 (c′) | Sí, con una mitigación parcial ya existente | Bajo, exige descuido del dueño | El expulsado, con colaboración del dueño | A: mostrar y retirar ofertas en el diálogo; B opcional | A: **No**; B: **Sí** | A medio; B alto | ¿A basta o también B? |
| #192 (c) | Sí | Bajo | El readmitido, con colaboración del dueño | Aceptar y documentar | No | Mínimo | ¿Se acepta como residual? |

## Orden de trabajo propuesto

1. **#259, solo comentario y tests de caracterización (sin cambiar la lógica).** Corregir el comentario de `:524-529` y añadir el test que prueba la asimetría del oráculo. Es la base para decidir y no cuesta nada. Va con el trabajo de reglas, así que lo revisa una persona.
2. **#193**, sin reglas. Es el que más valor da (privacidad) y no pasa por revisión de reglas. Incluye el test de reglas del lado del dueño y la nota del ADR 0015.
3. **#192, parte A** (mostrar y retirar ofertas en el diálogo), sin reglas. Cubre la causa común de (c) y (c′). Se hace tras #193 porque comparte la consulta y el borrado de ofertas por remitente.
4. **#259, cierre del oráculo (A2) e invariante del uid (B2).** Un único cambio de reglas, tras la decisión del responsable y tras comprobar en producción que no hay uids con `_`.
5. **#192, parte B** y su decisión, solo si el responsable la pide. Si no, nota en el ADR 0015 y cierre de la issue con (c) y (c′) como residuales aceptados.

Los pasos 2 y 3 se pueden hacer en paralelo. El 4 y el 5 comparten `isValidInvite` y deberían ir en la misma PR de reglas si se hacen los dos.
