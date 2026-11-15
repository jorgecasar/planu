# Spec: verificación de email y quitar acceso (GH-189)

Parte de #186. Se apoya en el [ADR 0006](adr/0006-sharing-with-invited-members.md)
(compartir con invitados), el [ADR 0011](adr/0011-verificacion-de-email-obligatoria.md)
(verificar el correo es condición de uso), el [ADR 0012](adr/0012-invitaciones-pendientes-por-email.md),
el [ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md) y el
[ADR 0014](adr/0014-ofertas-por-email-se-gastan-al-unirse.md).

Estado de este documento: las decisiones de producto Q1, Q2b, Q3 y Q5 están
**decididas** por el responsable; el resto (Q2a, Q4, Q6-Q9) son
recomendaciones adoptadas por defecto, que se pueden objetar al revisar la PR
de la rebanada correspondiente. Ver «Decisiones de producto». Las referencias de línea son de `main` en la fecha de redacción; el ADR 0015
(lápida al salir de un evento) **no está fusionado**, así que lo que dependa
de él se marca como tal y se cita contra su borrador, en la rama de GH-147.

## Objetivo

Tres cosas se hacen mal hoy:

1. **El aviso de verificación se explica mal.** Es lo primero que ve una cuenta
   nueva, y dice que verificar sirve para que «otras personas puedan invitarte».
   Es falso desde el ADR 0011: sin verificar no se puede crear, leer ni editar
   ni un evento propio.
2. **Quitar el acceso es instantáneo y mudo.** «Quitar acceso» y «Cancelar
   invitación» escriben al elegirlos, sin confirmar, sin deshacer y sin decir
   a quién se ha quitado.
3. **El selector de rol no explica qué es cada rol.** Quien invita elige entre
   Lector y Editor sin saber qué permite cada uno.

**Éxito** =
- una cuenta recién creada entiende en una lectura que tiene que confirmar el
  correo para empezar a usar planu, ve a qué dirección se envió y puede
  reenviarlo;
- volver a la pestaña tras verificar basta, sin recargar;
- el dueño no puede quitar a nadie por un clic accidental, y si lo hace sabe a
  quién, y puede corregirlo dentro de un margen razonable;
- quien invita sabe qué puede hacer cada rol antes de elegirlo.

## Usuarios y qué ven hoy

| Quién | Hoy |
| --- | --- |
| Cuenta nueva de email y contraseña | `guard.ts:49` la manda a `/app/profile` en cualquier ruta distinta. El perfil muestra un `wa-callout` «Verify your email so others can invite you to their events.» con dos botones planos, «Resend email» y «I have verified it» (`profile-view.ts:307-337`). La dirección no aparece en el aviso; sí en la ficha de la cuenta (`profile-view.ts:136`). |
| Cuenta de Google | Llega verificada (`session-adapter.ts`, ADR 0011): no ve el aviso. |
| Dueño de un evento | En el diálogo de compartir, cada fila tiene un menú con el rol y, al final, «Remove access» o «Cancel invitation» (`access-rows.ts:93-111`). Al elegirlo se escribe ya (`share-dialog.ts:205-208`, `#remove` 321, `#cancelInvite` 336). Sólo hay un `wa-callout` de error si falla. |
| Persona quitada | No se le avisa. El evento desaparece de su listado. No hay mecanismo de avisos (ver `spec-invitation-activity.md`, «Fuera»). |
| Quien invita | El `wa-select` de rol de `share-dialog.ts:165-168` no dice nada de qué permite cada valor. |

## Lo que hace el código hoy, comprobado

Para que ninguna decisión de abajo se apoye en la memoria.

### Verificación

- Bloqueo: `guardRedirect` (`auth/guard.ts:43-49`). Una sesión con email y sin
  verificar sólo puede estar en `/app/profile`. Es capa de UX; quien lo impone
  es `isVerified()` (`firestore.rules:8-10`), que lee el claim del token.
- Reenviar: `#onResend` (`profile-view.ts:373-387`) llama a
  `session.sendVerificationEmail()` (`session-adapter.ts:241`), pone `sent` y
  deja el botón desactivado **hasta recargar**. Si Firebase lo limita, el
  `catch` lo traga: la persona no ve nada.
- Comprobar: `#onCheck` (`profile-view.ts:351-371`) llama a
  `session.refreshEmailVerification()` (`session-adapter.ts:247-260`), que hace
  `reload(user)` y `getIdToken(true)`: **dos peticiones** a Firebase por
  comprobación. Después publica la entrada del directorio y sólo entonces
  actualiza `user`. No hay comprobación automática: sólo el botón.
- `onAuthStateChanged` **no** se dispara al verificar en otra pestaña
  (comentario en `profile-view.ts:339-350`): por eso hace falta comprobar a mano.

### Quitar acceso

- Miembro: `#remove` → `#write` → `sharing.updateEventMembership(eventId,
  { memberIds, roles }, removedUid)` (`share-dialog.ts:321-374`). El adaptador
  (`sharing-adapter.ts:298-326`) hace **un lote**: `update` del evento y, si
  la invitación del expulsado guarda un `inviteeEmail`, borra la oferta por
  email de esa dirección (ADR 0014). **No toca la invitación del expulsado:**
  queda `accepted`.
- Invitación pendiente: `#cancelInvite` → `sharing.revokeInvite(id)` =
  `deleteDoc` de `eventInvites/{eventId}_{uid}` (`sharing-adapter.ts:226`).
- El diálogo sólo lista invitaciones **por uid** (`listPendingInvites` consulta
  `eventInvites`). Las ofertas por email sin cuenta (`eventInvitesByEmail`) no
  aparecen y no se pueden cancelar desde aquí. No lo cubre este issue.
- Los miembros se muestran sin email (`access-list.ts:44`): no se publica.
  El email de un miembro sólo está en su documento de invitación.

### Qué permiten las reglas, por rol

De `firestore.rules`, no de memoria. Lector y Editor son lo que `roles[uid]`
dice; el dueño no tiene entrada en `roles` (`isValidMembership`, 64-74).

| Acción | Lector | Editor | Regla |
| --- | --- | --- | --- |
| Leer el evento | sí | sí | `allow read: isMember() && isVerified()` (259) |
| Cambiar título, descripción, ubicación, fechas, `allDay`, etiquetas e imagen (la URL) | no | sí | `isEditor() && changesContentOnly()` (82-88, 292); campos en `isValidEvent` (164-167) |
| Cambiar quién tiene acceso, los roles o el dueño | no | no | `changesContentOnly` fija `userId`, `memberIds`, `roles` y `createdAt` |
| Invitar, quitar o cambiar el rol de otra persona | no | no | sólo el dueño: la rama `isOwner()` del `update` (287-290) y `canManageMembers` (`permissions.ts:42`) |
| Borrar el evento | no | no | `allow delete: isOwner()` (300) |
| Salir del evento | sí | sí | `leavesTheEvent()` (145-153), con la cuenta verificada |
| Subir una imagen nueva a Storage | no | no | `storage.rules:10-26`: la escritura es sólo del dueño. Un Editor puede cambiar la URL de la portada a otra de Firebase Storage, pero no subir un fichero. Por eso la línea de ayuda no promete «cambiar la imagen» sin matiz |

Sobre el aviso de ayuda del rol: los cuatro verbos exactos de la tabla son los
que puede prometer el texto; ver Q7 por el matiz de la imagen.

### Por qué «Deshacer» no puede devolver el acceso directamente

Dos puertas, ninguna sirve:

- **El dueño no puede añadir miembros.** La rama del dueño exige
  `memberIds.hasOnly(resource.data.memberIds)` (`firestore.rules:287-290`):
  sólo puede conservar o quitar. Es lo que hace consensuada la pertenencia
  (ADR 0006).
- **Sólo el invitado se une**, por `acceptsInvite()` (104-137), que exige
  `get(invitePath()).data.status == 'pending'` y que el lote lo pase a
  `accepted`.

Por tanto, **«Deshacer» tras quitar a un miembro no puede ser «volver a
meterlo»**: sólo puede ser **volver a ofrecerle el evento** con el mismo rol, y
él acepta otra vez. Es lo que ya hace hoy el dueño al invitar de nuevo, y la
regla lo permite: `ownerReoffers()` (414-423) acepta pasar de `accepted` a
`pending` con `createdAt == request.time`; con ADR 0015 también desde
`removed` (borrador, `firestore.rules:430-439` de la rama de GH-147). Ya hay
test: `apps/web/rules/event-invites.test.ts:712-717`, «re-inviting someone
removed after accepting starts a fresh offer too».

`ownerReadmits()` (395-402) no sirve para «mismo rol»: sólo mueve
`status`/`decidedAt` y conserva el `role` **del momento de invitar**, que
puede no ser el que `event.roles[uid]` tenía al quitarlo si el dueño lo cambió
después. Hay que reescribir el documento entero, que es `ownerReoffers`.

Consecuencia de producto, no técnica: entre quitar y aceptar de nuevo la
persona **no tiene acceso** y, si deshaces, **recibe una invitación nueva** en
su bandeja. No es un «deshacer» invisible.

### Lo que #147 mantiene

- **Hoy en `main`:** al quitar, el lote gasta la oferta por email de la
  dirección que guarda la invitación (ADR 0014, `sharing-adapter.ts:306-322`).
  La invitación queda `accepted`. `acceptsInvite` exige `pending`, así que el
  expulsado no puede volver a entrar solo (`spec-invitation-activity.md`,
  «La decisión que falta»).
- **Con ADR 0015 (no fusionado):** el mismo lote escribe además una lápida
  `eventInvites/{eventId}_{uid}` con `status: 'removed'` y sin email
  (`writesTombstone`, 472-487 del borrador). `removesWithTombstone()` (162-168)
  hace que **el dueño no pueda quitar a nadie sin lápida**, y como la lápida es
  un `create`/`update` sobre el id ocupado, canjear una oferta por email falla.
  Sólo `ownerReoffers` la convierte otra vez en `pending`.

## Alcance

### Dentro

- Reescribir el aviso de verificación: texto, dirección, jerarquía de botones.
- Reenvío con enfriamiento visible y mensaje si Firebase lo limita.
- Comprobación automática al volver a la pestaña.
- Quitar acceso y cancelar invitación con la ceremonia híbrida decidida en Q3
  y anuncio accesible.
- Línea de ayuda bajo el rol: qué puede hacer un Lector y un Editor.
- Todos los textos en `msg()` con su `<target>` en `apps/web/xliff/es.xlf` y los
  generados regenerados (`AGENTS.md`, «Idiomas»).

### Fuera, y por qué

- **Avisar a la persona quitada.** Decidido (Q5): no se avisa. Además no hay
  mecanismo de avisos y por email exige backend (`spec-invitation-activity.md`).
- **Ofertas por email pendientes en el diálogo.** Hoy no se listan; mostrarlas
  y cancelarlas es otra historia.
- **Cambiar `firestore.rules`.** El objetivo es no tocarlas (ver «Rules»).
- **Cerrar los residuales (c) y (c′) del ADR 0015.** Siguen siendo decisión
  suya; esta spec no los empeora (ver Riesgos).
- **Cambio de rol con confirmación.** No es lo que pide el issue.
- **Mover la verificación fuera de `/app/profile`** o redirigir a casa tras
  verificar (ver Q9).

## Requisitos

### Verificación (R1-R4)

- **R1.** El aviso dice que hay que confirmar el correo **para empezar a usar
  planu** (texto decidido en Q1).
- **R2.** Muestra la dirección **completa** a la que se envió el mensaje
  (`user.email`) en el propio aviso (decidido en Q1).
- **R3.** «Reenviar correo» es la acción principal: `variant="brand"`; la
  comprobación manual pasa a secundaria (`appearance="plain"`). Tras reenviar,
  el botón se desactiva **60 s** con cuenta atrás visible (decidido en Q2b),
  no «hasta recargar». Si Firebase igualmente limita el envío, se muestra su
  error (`auth/too-many-requests`); cualquier otro fallo del envío también se
  dice (hoy el `catch` lo traga, `profile-view.ts:381-383`).
- **R4.** Al volver a la pestaña mientras el aviso está visible se comprueba la
  verificación **sin recargar** y sin pulsar nada: mismo camino que
  `#onCheck` (`reload` + `getIdToken(true)` + publicar la entrada del
  directorio). Cuando verifica, el aviso desaparece; mientras comprueba no
  parpadea ni mueve el foco. Evento y frecuencia: `visibilitychange` y mínimo
  10 s entre comprobaciones (Q2a, recomendación adoptada por defecto).

### Quitar acceso (R5-R10)

- **R5.** Ceremonia híbrida (Q3). **Miembro:** elegir «Remove access» abre una
  confirmación en la propia fila y **no escribe nada** hasta confirmar; no hay
  «Deshacer». **Invitación pendiente:** «Cancel invitation» escribe al elegir
  y muestra un aviso con «Deshacer», que es una segunda escritura.
- **R6.** La confirmación, el aviso y su anuncio nombran a la persona
  (`person.name`; para una invitación pendiente sin perfil, la dirección que
  el dueño escribió, que ya está en `Person.email`) y qué se hizo o se va a
  hacer: «Se quitó el acceso a X» o «Se canceló la invitación a X». Tras quitar
  a un miembro, el aviso dice además que **no se le avisa** a la persona
  (Q5).
- **R7.** «Deshacer» de una **invitación pendiente** la crea de nuevo con el
  mismo rol: `inviteToEvent` con el mismo `role` e `inviteeUid`. No hay
  lápida: el id estaba libre o con la invitación borrada, y la regla
  `create` (455-463) lo permite sin cambios.
- **R8.** Tras quitar a un **miembro**, el aviso ofrece la acción **«Volver a
  invitar»**, no «Deshacer»: vuelve a **ofrecer** el evento con el rol que
  tenía en `event.roles[uid]` **en el instante de quitar** (se captura antes
  de escribir). La persona vuelve a ser miembro **cuando acepta**. El texto no
  puede decir «restaurado»: dice «Invitación enviada de nuevo».
- **R9.** «Deshacer» y «Volver a invitar» no pueden reabrir lo que cierra la
  lápida. Escriben, y sólo,
  lo que escribe hoy un dueño que invita: un `set` de `eventInvites/{id}` en
  `pending` con `createdAt` del servidor, y el borrado de la oferta por email
  de la misma dirección si existe (`inviteToEvent`, `sharing-adapter.ts:158-190`).
  **No** escribe `memberIds`, **no** crea ofertas por email, **no** toca la
  lápida de otros. La oferta por email que quitar gastó no se recrea.
- **R10.** El anuncio a lectores de pantalla ocurre en una región viva
  **siempre montada** (`role="status"`, `aria-live="polite"`), con el texto de
  R6. El aviso que contiene «Deshacer» o «Volver a invitar» es alcanzable por teclado y no roba el
  foco. Al quitar una fila, el foco pasa a la fila siguiente o, si no la hay,
  al título «People with access»: hoy el menú que lo tenía desaparece con la
  fila.

### Explicación del rol (R11)

- **R11.** Bajo el selector de rol del formulario de invitar, una línea que
  describe los dos valores con las capacidades de la tabla de arriba; asociada
  al selector con `aria-describedby`. En cada fila, el menú de rol de
  `access-rows.ts` repite la ayuda si cabe sin romper la altura de fila (Q7).

### Transversales

- **R12.** Todo texto nuevo en `msg()`, con traducción al español en `es.xlf`;
  `npm run test:arch` verde (comprobación de mensajes desfasados).
- **R13.** Cero violaciones de axe en el diálogo (con el aviso y la ayuda) y en
  el perfil sin verificar.
- **R14.** Nada de Firebase fuera de `infrastructure/firebase/` (`AGENTS.md`,
  «Capas»): lo nuevo entra por el puerto. El tope de ficheros acoplados no
  sube (ver Riesgos).

## Reglas de Firestore: qué hay que cambiar

**Nada, con la ceremonia híbrida decidida en Q3.** Cada escritura de arriba
ya está permitida:

| Escritura | Regla que la permite | Fichero de tests de reglas donde vive |
| --- | --- | --- |
| Quitar miembro (hoy) | rama `isOwner()` del `update`, 287-290 | `rules/firestore.test.ts` |
| Cancelar invitación pendiente | borrado del dueño (ADR 0013) | `rules/event-invites.test.ts` |
| Deshacer cancelar | `create` por el dueño, 455-463 | idem |
| Volver a invitar tras quitar | `ownerReoffers()`, 414-423 (`accepted`→`pending`); con ADR 0015, desde `removed` | `event-invites.test.ts:712-717`; el caso `removed` lo tendrá la rama de #147 |

Qué haría falta **sólo** si algún día se quisiera un «Deshacer» de miembro
que devuelva el acceso sin que la persona acepte (no es lo decidido): permitir al
dueño añadir a `memberIds` dentro de una ventana, **o** que la invitación
conserve el estado `accepted` y el dueño la reactive. Ambas abren el hueco
que el ADR 0006 cerró (el dueño metiendo gente sin su consentimiento) y
cambian `acceptsInvite`, `isValidMembership` o el `update` del dueño. **No se
propone.** Si alguien lo pide, es otra spec con revisión humana de reglas.

Qué se prueba aunque no se cambie la regla (carga de prueba, no de código): un
test de reglas del caso exacto «quité a X, vuelvo a invitar, X no vuelve a ser
miembro hasta aceptar»: el dueño intenta `arrayUnion(X)` tras deshacer y se deniega.

## Criterios de aceptación

Verificables, de dos en dos con su test.

### Verificación

1. Una cuenta sin verificar con `user.email = "a@b.c"` ve en el aviso «Confirma
   tu correo para empezar a usar planu. Te enviamos un mensaje a a@b.c» (en
   inglés el `msg()`; la dirección completa, sin enmascarar). (Unitario en
   `profile-view.test.ts`.)
2. El botón «Reenviar correo» es el único `variant="brand"` del aviso y recibe
   el foco con Tab antes que «Ya lo he verificado». (Unitario.)
3. Pulsar «Reenviar» llama a `sendVerificationEmail` una vez; durante los 60 s
   un segundo clic no llama y hay una cuenta atrás visible; pasados los 60 s
   vuelve a poder. (Unitario con reloj falso, **y se rompe a propósito**
   quitando el enfriamiento para ver que el test falla.)
4. Si `sendVerificationEmail` rechaza, aparece un mensaje de error (el de
   Firebase si es `auth/too-many-requests`) y el botón no queda desactivado
   para siempre. (Unitario.)
5. Con la pestaña oculta y luego visible, y `emailVerified` aún falso en el
   proveedor, `refreshEmailVerification` se llama **una** vez y el aviso sigue.
   (Unitario: se dispara `visibilitychange` con `document.visibilityState`
   simulado.)
6. Con el proveedor ya verificado, el mismo evento oculta el aviso y publica la
   entrada del directorio una vez. (Unitario.)
7. Dos `visibilitychange` seguidos antes del intervalo mínimo hacen **una**
   comprobación. (Unitario.)
8. Con el aviso oculto (cuenta verificada) no se registra ningún escuchador.
   (Unitario: sin evento, sin llamada.)
9. e2e: crear cuenta en el emulador, ver el aviso con la dirección,
   verificar en el emulador (código OOB), volver a la pestaña y ver el listado
   sin recargar. axe en verde. (`e2e/profile.spec.ts` o `auth.spec.ts`.)

### Quitar acceso

10. Elegir «Remove access» sobre un miembro no llama a
    `updateEventMembership` hasta pulsar «Quitar» en la confirmación en línea.
    (Unitario en `share-dialog.test.ts`, con un puerto espía.)
11. La confirmación y el aviso contienen el nombre de la persona (y, si es una
    invitación pendiente sin perfil, la dirección). Tras quitar a un miembro,
    el aviso dice que no se le avisa. (Unitario.)
12. Cancelar la confirmación no escribe nada y deja la fila como estaba.
    (Unitario.)
13. «Deshacer» de una invitación cancelada llama a `inviteToEvent` con el
    mismo `role` e `inviteeUid`. Quitar a un miembro **no** ofrece «Deshacer».
    (Unitario.)
14. «Volver a invitar» tras quitar a un miembro llama a la operación de
    re-oferta con el rol capturado **antes** de la escritura, aunque el evento
    recargado ya no lo traiga. (Unitario: el rol de un Editor sobrevive al
    `load()`.)
15. «Deshacer» y «Volver a invitar» respetan el tope de 20 invitados: si entre
    medias se llenó el evento, no escriben y lo dicen. (Unitario; mismo
    cálculo que `#onInvite`, `share-dialog.ts:250-256`.)
16. Tras «Volver a invitar», la persona **no** está en `memberIds`
    hasta que acepta. (Test de reglas: el dueño no puede `arrayUnion`; el
    invitado acepta y entra con el rol capturado.)
17. Quitar y volver a invitar deja, con ADR 0015 fusionado, la invitación en `pending`
    y no deja ninguna oferta por email viva para esa dirección. (Test de
    reglas/adaptador; depende de #147.)
18. El texto de R6 está dentro de una región con `role="status"` presente
    **antes** de que cambie su contenido. (Unitario: la región existe en el
    primer render.)
19. El foco, tras quitar la última fila, queda en un elemento que existe.
    (Unitario.)
20. e2e con dos sesiones (`e2e/sharing.spec.ts`): el dueño quita a un
    invitado tras confirmar, el invitado deja de ver el evento, el dueño pulsa
    «Volver a invitar», el invitado ve una invitación y al aceptar vuelve a ver el evento con el mismo rol.
    axe en verde en cada estado.

### Rol

21. Bajo el selector hay un texto con las capacidades de Lector y de Editor, y
    el `wa-select` lo referencia con `aria-describedby`. (Unitario.)
22. El texto no afirma nada que la tabla de capacidades no respalde. No es
    automatizable de forma honesta: va en la lista de revisión de S4, que
    contrasta cada verbo con una línea de `firestore.rules`.

### Transversal

23. `npm run localize:extract` no deja `<target>` vacíos y `npm run
    test:arch` pasa (R12). Código de salida 0 de `npm run lint`, `npm run
    typecheck`, `npm test`, `npm run test:rules`.

## Tareas

Rebanadas de ≤200 líneas (código y tests; los `.xlf`/`generated` cuentan
aparte, son mecánicos). Cada una acaba verde por sí sola, y cada PR es un
solo commit aplastado.

**Ninguna toca `firestore.rules`.** Si durante S5 un test de reglas contradice
la tabla de arriba, se detiene la rebanada y se pregunta: ese cambio sí
necesitaría revisión humana de reglas, y no está en esta spec.

| # | Rebanada | Toca | Tests | Depende de |
| --- | --- | --- | --- | --- |
| S1 | Aviso de verificación: texto, dirección, «Reenviar» principal | `profile/profile-view.ts`, `xliff/es.xlf`, `generated/locales/*` | unitario `profile-view.test.ts` (crit. 1, 2) | — (Q1 decidida) |
| S2 | Reenvío: enfriamiento de 60 s con cuenta atrás y error visible | `profile/profile-view.ts`, `es.xlf` | unitario (3, 4) | S1 |
| S3 | Comprobación al volver a la pestaña | `profile/profile-view.ts` (o un controlador `profile/visibility-check.ts` si pasa de ~60 líneas) | unitario (5-8) | S1 |
| S4 | Línea de ayuda del rol | `sharing/share-dialog.ts`, `sharing/access-rows.ts`, `es.xlf` | unitario `share-dialog.test.ts`, `access-rows.test.ts` (21, 22) | — |
| S5 | Re-oferta de un miembro quitado («Volver a invitar»): operación del puerto | `application/ports/sharing.ts`, `infrastructure/firebase/sharing-adapter.ts` | `sharing-adapter.test.ts`; `rules/event-invites.test.ts` (16, 17: **sólo tests**) | #147 para el caso `removed` |
| S6 | Ceremonia híbrida: confirmación en línea de miembro; aviso con «Deshacer» de invitación pendiente; «Volver a invitar» tras quitar; anuncio | `sharing/share-dialog.ts`, `sharing/access-rows.ts`, `es.xlf` | unitario (10-15, 18, 19) | S5 |
| S7 | e2e y axe del flujo completo | `e2e/profile.spec.ts`, `e2e/sharing.spec.ts` | e2e (9, 20) | S1-S6 |

Orden: S1 → {S2, S3} en paralelo; S4 aparte, sin dependencias de código;
S5 → S6 → S7. S1-S3 y S4-S7 son dos hilos independientes.

Lo que hay que saber de S5. La operación nueva existe porque `inviteToEvent`
**no basta para un miembro**: pide `inviteeEmail` y el diálogo no lo tiene de
los miembros (`access-list.ts:44`), así que re-ofrecer por ahí **machacaría** el
`inviteeEmail` guardado con `""`, y ese dato es el que usa `updateEventMembership`
para gastar la oferta por email (`sharing-adapter.ts:309-322`). La operación
nueva lee el documento de invitación del quitado, reutiliza su
`inviteeEmail`, `invitedByName` y `eventTitle` cuando existen, y sólo rellena
desde el evento y la sesión si la persona había borrado su invitación (ADR
0013; `inviteeEmail` es opcional en `isValidInvite`, 334-335). Nombre y firma
quedan para el implementador: `restoreAccessOffer(eventId, uid, role)` es una
sugerencia.

Si la ceremonia de Q3 necesita una ADR (la semántica «Volver a invitar = volver
a ofrecer, no restaurar»), la numeración libre es
**0017**: 0015 está reservado para la lápida y 0016 existe. Va con S5, no con
S6.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| «Volver a invitar» puede leerse como «restaurar» y sólo ofrece de nuevo: el dueño cree que la persona ha vuelto | El botón no se llama «Deshacer» (Q3); texto de R8; criterio 16 |
| Escritura diferida con cuenta atrás: cerrar la pestaña durante la espera dejaría a la persona dentro | No aplica: Q3 descartó la escritura diferida. El miembro se quita al confirmar y la invitación pendiente al elegir |
| Volver a ofrecer reabre el residual (c) del ADR 0015: el invitado borra la invitación pendiente y canjea una oferta por email **anterior** a la expulsión | Quitar la gasta si hay `inviteeEmail` en la invitación (ADR 0014); la re-oferta también la borra (`inviteToEvent`). No lo empeora: sólo habría una oferta viva si el dueño la creó después, y eso es un acto suyo. Tampoco lo cierra: sigue siendo decisión pendiente del 0015 |
| (c′): el dueño re-ofrece y después **cancela** la invitación: se borra el documento y con él la lápida | Mismo mecanismo que ya existe hoy sin «Deshacer»: el dueño ya puede cancelar una invitación pendiente. La lápida del ADR 0015 no cambia eso; sigue siendo decisión pendiente del 0015 |
| Dos pestañas del dueño, o el invitado actúa durante la espera: el estado ya no es el capturado | «Deshacer» y «Volver a invitar» hacen su escritura sobre el estado real (`inviteToEvent` lee el documento antes). Si falla, error genérico existente («The change could not be saved…») y recarga |
| Comprobar al volver a la pestaña gasta 2 peticiones por visita | Intervalo mínimo (crit. 7) y sólo mientras el aviso existe; sin sondeo |
| Un escuchador de `visibilitychange` que no se desregistra fuga | Registrar en `connectedCallback`/`hostConnected` y quitar en la desconexión; crit. 8 |
| El texto de ayuda del rol envejece cuando cambien las reglas | Crit. 22 y la tabla de capacidades de esta spec con su línea de regla; si un cambio de reglas toca `changesContentOnly`, esa tabla y el texto son parte del cambio |
| `noUnusedPrivateClassMembers` está desactivada: un campo nuevo muerto no se detecta | Revisión; los tests de S6 recorren cada campo nuevo |
| El conteo de ficheros acoplados (`arch/boundary.test.ts`) | S5 no añade ficheros bajo `infrastructure/firebase/`; el test del adaptador va en `sharing-adapter.test.ts`, que ya cuenta. **No se sube el tope**; si hiciera falta un fichero, se descarta el test, no se sube el tope |

## Estrategia de tests

- **Unitarios** (Vitest en Chromium): aviso, reenvío con reloj falso,
  `visibilitychange`, la confirmación y «Deshacer» con un puerto espía que
  registra el orden de las llamadas.
- **Reglas** (`npm run test:rules`, emulador): sólo casos nuevos de las
  transiciones que ya existen; ver criterios 16 y 17.
- **e2e** (`npm run test:e2e`): dos sesiones; axe en cada estado visible.
- **Prueba que falla**: cada test nuevo se rompe a propósito una vez
  (`AGENTS.md`, «Verificar de verdad»): quitar el enfriamiento, escribir antes
  de confirmar, capturar el rol después de recargar. Si pasa igual, no vale.
- Nada de `biome check --write` a ciegas.

## Decisiones de producto

Dos estados. **DECIDIDA**: la tomó el responsable. **Recomendación adoptada
por defecto**: nadie la objetó; el responsable puede objetarla al revisar la
PR de la rebanada correspondiente. Las opciones descartadas se conservan por
el porqué.

### Q1. Texto del aviso y dirección: DECIDIDA, opción A

Dirección **completa**: «Confirma tu correo para empezar a usar planu. Te
enviamos un mensaje a {email}.» + «Reenviar correo» (principal) + «Ya lo he
verificado» (secundario). Descartadas: enmascarar la dirección, no mostrarla.

Hechos: la dirección ya está a la vista en la ficha de la misma página
(`profile-view.ts:136`) y el aviso sólo lo ve la propia cuenta, sin sesión
ajena; enmascarar no protege nada que no esté ya en pantalla, pero sí ayuda a
quien se equivocó al escribirla a notarlo (con la dirección completa se ve el
fallo; enmascarada, menos). El formulario de cambiar correo ya vive dentro del
aviso para cuentas de contraseña.

El texto en inglés del `msg()`, para que `es.xlf` lo traduzca: «Confirm your
email to start using planu. We sent a message to {email}.»

### Q2a. Qué evento dispara la comprobación: recomendación adoptada por defecto

`visibilitychange` a `visible`, con un intervalo mínimo de 10 s entre
comprobaciones y sólo mientras el aviso está visible. Sin sondeo. Salta al
volver de otra pestaña, y en móvil al volver de la app de correo. Alternativas
no adoptadas: `window` `focus` (salta además al volver de devtools u otra
ventana; en móvil es menos fiable) o ambos deduplicados.

Cada comprobación son dos peticiones (`reload` + `getIdToken(true)`,
`session-adapter.ts:253-254`) y una tercera si verifica (publicar el
directorio). Sin intervalo, alternar pestañas sin parar las repite.

### Q2b. Límite de reenvío: DECIDIDA

Enfriamiento de cliente de **60 s** tras cada envío, con cuenta atrás visible,
y **mostrar el error de Firebase** (`auth/too-many-requests`, hoy tragado) si
igualmente limita. Descartadas: no tener enfriamiento propio y un solo
reenvío por carga.

Los 60 s los fija el responsable, no son un dato de Firebase: no hay en el
repo una cifra del límite del servidor. Un enfriamiento de cliente no protege
(se salta recargando); sólo evita el clic nervioso.

### Q3. Quitar acceso, ceremonia: DECIDIDA, opción híbrida

- **Invitación pendiente.** «Cancel invitation» escribe al elegir y muestra un
  aviso con «Deshacer», que la recrea con el mismo rol (R7).
- **Miembro.** «Remove access» abre una **confirmación en línea** en la propia
  fila («¿Quitar el acceso a Ana? [Quitar] [Cancelar]»); la escritura va al
  confirmar y **no hay «Deshacer»**. Después del borrado, el aviso ofrece
  **«Volver a invitar»** (R8).

Razón: el acceso de un miembro no puede devolverse sin que acepte (ver «Por
qué “Deshacer” no puede devolver el acceso»), así que el botón nunca promete
lo que no puede cumplir. Descartadas: confirmación sin más, escritura
diferida con cuenta atrás (cerrar la pestaña dejaría a la persona dentro sin
que el dueño lo sepa) y «Deshacer» inmediato para miembros.

### Q4. Qué restaura «Deshacer»: recomendación adoptada por defecto

Consecuencia de Q3, no una pregunta nueva. Para una invitación pendiente:
mismo rol, misma persona, invitación nueva con fecha nueva (`createdAt` del
servidor; no se puede reutilizar la antigua, regla 359-366). Para un miembro,
«Volver a invitar» en lugar de «Deshacer».

Con ADR 0015: la re-oferta no reabre la puerta que cierra la lápida. La
lápida sólo la levanta `ownerReoffers` (acto explícito del dueño, ADR 0015
«Decisión»), y la re-oferta es exactamente ese acto. Lo que ese ADR deja
abierto, (c) y (c′), queda igual de abierto.

### Q5. ¿Se avisa a la persona quitada?: DECIDIDA, no

No se avisa: el evento desaparece de su listado (lo de hoy). Fuera de
alcance. Un aviso dentro de la app abriría «notificaciones genéricas» y por
email no es posible hoy (`spec-invitation-activity.md`). El aviso al dueño lo
dice: «Se quitó el acceso a Ana. No se le avisa.»

### Q6. Anuncio accesible: recomendación adoptada por defecto

Región viva siempre montada, `role="status"`, cortés (R10). Alternativa no
adoptada: `wa-toast`, que gestiona su propia región.

El `wa-callout role="status"` que existe hoy se monta ya con su texto
(`share-dialog.ts:151`), y muchos lectores de pantalla no anuncian regiones
que nacen con contenido.

### Q7. Línea de ayuda del rol: recomendación adoptada por defecto

Texto propuesto (inglés, para `msg()`):

> Viewer: can see the event. Editor: can also change its details. Neither can
> invite, remove people or delete the event.

- **Dónde:** bajo el `wa-select` del formulario (R11, siempre visible), no en
  cada fila: en las filas rompe la altura uniforme (`access-rows.ts:168-175`)
  y quien cambia un rol ya lo eligió una vez.
- **Imagen:** un Editor puede cambiar la URL de la portada pero no subir un
  fichero (`storage.rules:10-26`). «Cambiar los detalles» no promete subir.
  Si se quiere ser explícito, hay que decir «no puede subir una imagen nueva»,
  y eso es un matiz que casi nadie esperará.

### Q8. ¿Texto distinto para Google?: recomendación adoptada por defecto

Una cuenta de Google nunca ve el aviso (llega verificada). Sin cambios.

### Q9. Tras verificar, ¿adónde va la persona?: recomendación adoptada por defecto

Hoy se queda en `/app/profile` con el aviso oculto: el guard sólo redirige
cuando hay navegación, y `onAuthStateChanged` no se dispara
(`profile-view.ts:339-350`). Con la comprobación automática de R4 la persona
verifica en otra pestaña, vuelve, y se queda en un perfil sin nada que hacer.

Adoptado por defecto: **quedarse** (lo de hoy), porque llevarla a
`HOME_PATH` cambiaría un comportamiento que el issue no nombra. Llevarla a
casa al verificar queda fuera de alcance; el responsable puede pedirlo al
revisar la PR de S3.

## Lo que no he podido fundamentar en el código

- **Cifra del límite de reenvío de Firebase.** No está en el repo. Los 60 s de
  Q2b son una decisión del responsable, no una medida.
- **Si `emailOfferTo` con `inviteeEmail` vacío es inocuo.** Lo es por lectura
  (`emailHash("")` apunta a un id que no existe), pero no hay test; por eso S5
  no pasa por ahí.
- **El caso `removed` → `pending` en `ownerReoffers`.** Está en el borrador del
  ADR 0015 (rama de GH-147, `firestore.rules:430-439`), no en `main`; hasta
  que se fusione, el caso se prueba sólo con `accepted`.
- **Que el invitado quitado vea de verdad la invitación nueva.** Lo hace
  `watchReceivedInvites` (consulta de pendientes por `inviteeUid`), pero no he
  ejecutado el flujo: lo comprueba el e2e del criterio 20.
- **`profile-view.ts:296`**, que cita el issue, ya no es el aviso: el aviso
  está en 307-337 (el comentario de la línea 289-293 es de otro bloque).
