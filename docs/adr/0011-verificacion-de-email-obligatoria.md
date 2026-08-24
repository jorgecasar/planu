# 0011 · Verificación de email obligatoria para usar la aplicación

- **Fecha:** 2026-08-24
- **Estado:** aceptado

## Contexto

`sendEmailVerification` ya se llamaba al registrarse
(`infrastructure/firebase/session-adapter.ts:129`), pero verificar el correo
no tenía ningún efecto sobre el acceso a la aplicación. `firestore.rules` no
mencionaba `email_verified` en ningún `allow` de `events`, y el único lugar
del cliente que consultaba `emailVerified` era `sharing/user-directory.ts`
(líneas 118 y 296): gobernaba si la cuenta se publicaba en el directorio de
compartición, nada más. Una cuenta de email/contraseña sin verificar podía
crear, leer y editar eventos con total normalidad; el único síntoma de no
verificar era no ser invitable por otra persona.

Esto se comprobó contra código, no se supuso —ver
[`SPEC-verificacion-email-invitaciones.md`](../../SPEC-verificacion-email-invitaciones.md),
"Contexto verificado"—, y además contra producción: una cuenta real
(`yogarciag@hotmail.com`, proyecto `planu-app`) tenía `emailVerified: true` en
Firebase Auth y el cliente ya no mostraba el aviso de verificación, pero
`userDirectory` no tenía ninguna entrada para su email. La causa era un fallo
de diseño independiente en `profile/profile-view.ts`: el aviso se ocultaba en
cuanto `emailVerified` pasaba a `true`, **antes** de comprobar que la
publicación en el directorio hubiese tenido éxito; si esa publicación fallaba
—aquí, porque el token de la sesión nunca se había reemitido desde el
registro—, el aviso desaparecía para siempre y con él la única vía de la
interfaz para reintentarlo. Corregido en T59, antes de construir nada encima:
sin ese arreglo, cualquier disparador nuevo que dependiera de "el aviso ya no
se ve" habría heredado el mismo hueco.

Google llega con `emailVerified: true` de fábrica
(`session-adapter.ts:124`), así que esta decisión no le añade fricción.

## Decisión

**Verificar el correo pasa a ser condición de acceso a la aplicación, no sólo
al directorio de compartición.** Alcanza a `firestore.rules` —quien de
verdad lo hace cumplir— y a la UI, que redirige a quien no cumple la
condición.

### `isVerified()` en `firestore.rules`, dentro de los `allow` existentes

```
function isVerified() {
  return request.auth.token.email_verified == true;
}
```

Se lee el claim del token, nunca el estado en vivo de la cuenta de Auth:
leer el estado en vivo exigiría un token nuevo para hacer efecto igual —es
justo el bug de T59 arriba— así que no hay nada que ganar comprobando otra
cosa.

Se añade **dentro** de los `allow` ya existentes de `events`
(`create`, `read`, `update`), nunca como un `allow` separado: las reglas de
Firestore se combinan con OR, y separar una condición en su propio `allow`
anularía las demás en vez de sumarse — es la fuga original del prototipo
que [`0002`](0002-eventos-privados-por-usuario.md) ya documentó y que este
ADR no reintroduce. En `allow update`, `isVerified()` se puso por delante de
las cuatro ramas OR-eadas (propietario, editor, `leavesTheEvent()`,
`acceptsInvite()`) en vez de dentro de cada una: una cuenta sin verificar no
puede tocar un evento por ninguna puerta, y una sola cláusula lo dice una vez
en lugar de cuatro con el riesgo de olvidar alguna. Decisión confirmada con
el usuario antes de revisar, no asumida por el agente.

### El guard del cliente redirige, no decide

`auth/guard.ts` gana la condición `unverified` en `guardRedirect()`: una
sesión con email sin verificar que pida cualquier ruta que no sea
`/app/profile` ni `/app/login` se redirige a `/app/profile`. Es capa de UX,
no la que hace cumplir la regla —eso sigue siendo `firestore.rules`—, y
existe para que la persona vea por qué no puede hacer nada en vez de
encontrarse errores de permiso sueltos por toda la interfaz.

### Google, sin fricción

Una cuenta de Google llega verificada de fábrica y `isVerified()` nunca la
bloquea; no hay caso especial que mantener porque el propio proveedor ya
satisface la condición.

## Consecuencias

- **Una cuenta de email/contraseña sin verificar no puede crear, leer ni
  editar eventos**, ni siquiera los suyos, hasta que verifique. Antes sólo
  perdía la posibilidad de ser invitada; ahora pierde el uso completo de la
  aplicación. Verificado con `npm run test:rules`: sin verificar deniega las
  tres operaciones, verificada las mantiene, Google no nota nada — casos en
  `apps/web/rules/firestore.test.ts` y `apps/web/rules/event-invites.test.ts`.
- **`isVerified()` es infalsificable por el cliente**: es un claim del token,
  no un dato del documento, así que ninguna escritura puede reescribirlo.
  Confirmado por `security-auditor` contra el emulador, no razonado en
  abstracto — ver la entrada de T60 en `tasks/todo.md`.
- **Hallazgo real, encontrado al cerrar T66, y corregido en la misma tarea
  tras confirmarlo con la persona presente.** `isVerified()` sólo se había
  añadido al `match /events/{eventId}` (T60) y al `create` de
  `eventInvitesByEmail` (T62). La colección hermana `eventInvites` —donde
  vive la invitación mientras está pendiente— no lo comprobaba en ninguna de
  sus operaciones. Dos consecuencias, verificadas contra el emulador por un
  `security-auditor` independiente (no razonadas en abstracto, y no las del
  mismo agente que cerró la tarea): (a) un propietario sin verificar, ya
  bloqueado en `events`, conservaba intacta la capacidad de crear, editar,
  revocar y volver a ofrecer invitaciones de un evento suyo; (b) un invitado
  sin verificar podía, con un `updateDoc` suelto fuera del batch atómico que
  usa `invitations.ts`, poner su propia invitación en `"accepted"` sin llegar
  a entrar en `memberIds` — la gasta sin unirse, y sólo el propietario puede
  reabrirla con `ownerReadmits()`.

  Confirmado con la persona presente que se corregía en esta misma tarea en
  vez de aplazarse: `isVerified()` local (las funciones no cruzan `match`
  blocks) añadida a `allow create` (sólo la rama del propietario —
  `claimsPendingByEmail()` ya exige el email verificado de quien reclama, no
  duplicado), `allow update` (delante de las cuatro ramas OR-eadas, incluida
  `invitedDecides()`) y `allow delete`. Una segunda pasada del mismo
  `security-auditor` sobre el arreglo encontró un tercer hueco, más pequeño
  y de la misma familia: `eventInvitesByEmail`'s propio `allow delete`
  (rama del propietario) tampoco exigía verificación — corregido igual. Un
  checker de correctitud, en paralelo, encontró además dos huecos de
  *cobertura* (no de seguridad): faltaba un test de "reclamante sin
  verificar no puede reclamar", y el test del batch de "aceptar" no podía
  distinguir qué mitad denegaba —un batch atómico falla entero si cualquier
  mitad lo hace, así que "probar con el batch" no aísla nada—; ambos
  corregidos con escrituras sueltas a una sola colección, que sí aíslan lo
  que cada una dice probar. Cada arreglo se confirmó "load-bearing"
  —revertido uno a uno, confirmado que el test correspondiente falla sin
  él, restaurado— antes de comitear. Evidencia final: `npm run test:rules`
  en 0 (220/220), resto de la suite sin regresión.
- **El aviso de verificación ya no puede desaparecer sin haberse publicado de
  verdad** (T59): si `publishDirectoryEntry` falla tras verificar, el aviso
  sigue ofreciendo reintentar, en vez de desaparecer para siempre. La
  instrumentación de T65 (`recordBackgroundWrite`, en
  `observability/index.ts`) distingue si ese fallo fue denegación de regla,
  red, o desconocido, en vez de tragarlos todos igual.
- **Sin backfill ni migración de cuentas.** Esta decisión no toca cuentas ya
  existentes: sólo cambia lo que las reglas exigen a partir de ahora.
- **Bloqueo abierto, sin resolver por este ADR**: si ya hay cuentas reales
  sin verificar en producción (`planu-app`) con eventos creados, esta
  decisión las bloquearía hasta que verifiquen. No se ha comprobado si eso es
  aceptable o si hace falta avisar antes de desplegar — requeriría acceso de
  administración que cae en "preguntar primero", igual que el backfill de
  `memberIds` que ya documenta `AGENTS.md`. Queda como decisión pendiente de
  una persona, no de un agente; ver "Bloqueos abiertos" en `tasks/plan.md`.
- No reescribe [`0006`](0006-sharing-with-invited-members.md) ni
  [`0007`](0007-client-side-user-directory.md): ninguno de los dos hablaba de
  verificación como condición de acceso, sólo como condición de
  publicación en el directorio. Este ADR añade la primera sin tocar la
  segunda.
