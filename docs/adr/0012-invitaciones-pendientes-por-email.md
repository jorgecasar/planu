# 0012 · Invitaciones pendientes por email sin revelar cuenta

- **Fecha:** 2026-08-24
- **Estado:** aceptado
- **Complementa:** [`0007-client-side-user-directory.md`](0007-client-side-user-directory.md)

## Contexto

El propio [`ADR 0007`](0007-client-side-user-directory.md) ya nombró, en sus
Consequences, que se puede comprobar si un email dado tiene cuenta: "It is
possible to check whether a given email is registered. [...] Forbidding
`list` bounds it, but does not remove it." y lo dejó pendiente de reflejar en
política de privacidad (F13), sin cerrarlo.

Hasta esta decisión, ese conocimiento se filtraba además a través de la
propia interfaz: `sharing/share-dialog.ts` respondía *"Nobody with that email
has an account yet"* cuando el email invitado no estaba en `userDirectory`, y
un mensaje distinto cuando sí estaba. Invitar a alguien sin cuenta, además,
no escribía nada — la invitación se perdía sin dejar rastro, y si esa persona
se registraba después, nadie volvía a intentarlo.

El proyecto sigue sin servidor: sin Cloud Functions, sin plan Blaze, por el
mismo motivo de coste recurrente que ya fijó el ADR 0007. Esta decisión vive
dentro de esa restricción, no la reabre.

## Decisión

### Ofertas pendientes en `eventInvitesByEmail`, mismo patrón que `userDirectory`

Nueva colección, indexada por `{eventId}_{sha256(email)}`, con el mismo
estilo de reglas que `userDirectory`: quien posee el evento puede `create`
una oferta; sólo quien demuestre ser dueño del email invitado (verificado)
puede leerla o reclamarla; **sin `list`**, por el mismo motivo que
`userDirectory` no lo permite — separar "comprobar una dirección conocida"
de "censar la colección entera".

El reclamo se modeló como `delete` en `eventInvitesByEmail` + `create` en
`eventInvites`, dentro de un mismo batch atómico del cliente, cada mitad
autorizada de forma independiente por su propia regla —no depende de que las
dos mitades lleguen siempre juntas—.

Una ronda de `security-auditor` sobre esta colección (T62) encontró y forzó a
corregir dos problemas reales antes de fusionar nada, ambos con pruebas
contra el emulador, no razonados en abstracto:

- **[MEDIUM]** la regla de lectura original dejaba que cualquier verificado
  que conociera un `eventId` probara direcciones de email una a una y supiera
  cuáles tenían invitación pendiente en ese evento — un oráculo *más fuerte*
  que el que el propio ADR 0007 ya aceptó para `userDirectory` (que responde
  igual exista o no la entrada). Corregido con `isOwnEmailForId()`: comprueba
  el sufijo de hash del *id* contra el propio email verificado del que pide
  leer, así que la rama de "documento inexistente" sólo se abre para quien
  comprueba su propia bandeja.
- **[LOW]** quien reclamaba podía escribir un `inviteeEmail` arbitrario en el
  `eventInvites` resultante. Corregido fijándolo igual que los demás campos
  ya fijados por la regla.

Una segunda ronda, al cerrar T66 (ver [`0011`](0011-verificacion-de-email-obligatoria.md)
para el hallazgo hermano en `eventInvites`), encontró un tercer problema en
esta misma colección: **[LOW]** `allow delete` en su rama del propietario
—retirar una oferta que nadie ha reclamado— tampoco exigía email verificado,
a pesar de que `allow create` en esta misma colección ya lo exige desde el
principio. Corregido exigiéndolo también ahí, sin afectar a la rama del
reclamante (`isOwnEmail()`, que ya exige su propio email verificado por
separado). Verificado "load-bearing" (revertido, confirmado que el test
nuevo falla, restaurado) antes de comitear, y reconfirmado por el mismo
`security-auditor` con pruebas propias sobre el estado final.

### `share-dialog.ts`: el mismo mensaje exista o no la cuenta

`offerInviteByEmail()`, gemela de `inviteToEvent()` en
`sharing/user-directory.ts`, escribe en `eventInvitesByEmail` cuando
`findUserByEmail` no encuentra cuenta, en vez de fallar sin guardar nada. Un
único `msg()` de éxito —"Invitation sent. They join once they accept it."—
vive fuera del `if`/`else` que decide a qué colección escribir, así que no
hay dos cadenas parecidas que puedan desincronizarse. `findUserByEmail`
además distingue ahora `permission-denied` de "documento no existe": un
fallo de permisos ya no sale disfrazado del mismo mensaje que "no hay
cuenta".

### `claimPendingInvitesByEmail()`, en los mismos dos disparadores que `publishDirectoryEntry`

Nueva función en `sharing/user-directory.ts`, llamada inmediatamente después
de `publishDirectoryEntry` en los mismos dos sitios donde ésta ya se llama
—`firebase-provider.ts:292-304` en cada arranque de sesión, y
`profile-view.ts` tras el arreglo de T59—, sin un tercer disparador nuevo.
Paráfrasis de esa llamada, con el mismo comentario que lleva en el código real
(`firebase-provider.ts:300-303`, con el parámetro llamado `sessionUser` allí y
`refreshed` en `profile-view.ts`, no `user`):

```ts
// Same two call sites as publishDirectoryEntry, deliberately: whatever makes
// someone invitable is exactly what makes a pending-by-email offer of theirs
// resolvable, and duplicating the trigger would just be a second thing that
// could go out of sync with the first.
await claimPendingInvitesByEmail(firestore, sessionUser).catch(() => {});
```

## Consecuencias

**Lo que sí mejora:**

- Invitar a quien tiene cuenta se comporta exactamente igual que antes:
  regresión cero, mismo mensaje de éxito, verificado con mutación
  deliberada del código para confirmar que los tests lo detectarían si
  dejara de serlo (`npm test` 604/604 en el momento del cierre de T64).
- Invitar a quien no tiene cuenta ya no revela su ausencia en la interfaz, y
  la oferta queda guardada en vez de perderse — confirmado contra
  `npm run test:rules` (204/204) y contra un `test:e2e` real, con emulador
  aislado, no aceptado de palabra.

**Lo que esto NO resuelve — dicho explícitamente, no supuesto:**

**(a) No cierra la fuga de red que ya nombró el ADR 0007.** Sin servidor, el
propio cliente sigue teniendo que consultar `userDirectory` para saber a qué
colección escribir —`eventInvites` si hay cuenta, `eventInvitesByEmail` si no
la hay—, y esa consulta, según devuelva un documento o no, sigue siendo
observable a nivel de red por quien inspeccione el tráfico. Es exactamente el
límite que el ADR 0007 ya nombró: *"Forbidding list bounds it, but does not
remove it."* Esta decisión quita el mensaje que lo revelaba **en la
interfaz**, no la observabilidad de red subyacente. Cerrarla del todo exige
un backend, que es justo lo que esta conversación decidió no montar.

**(b) El reclamo automático es hoy un no-op documentado en producción.**
En `eventInvitesByEmail` un `list` sin filtrar se deniega a propósito —mismo
motivo que `userDirectory`—; sólo pasa la consulta del propio dueño filtrada
por `invitedBy`, y el invitado sigue sin poder listar. Así que quien reclama
sólo puede hacer `get()` de un id si ya conoce el `eventId` de antemano. Ninguno de los dos disparadores
de `claimPendingInvitesByEmail()` —arranque de sesión, botón "I have verified
it" del perfil— tiene un `eventId` en contexto: disparan de forma global, no
dentro de un evento concreto. La función se implementó aceptando una lista
explícita de `eventId` candidatos
(`claimPendingInvitesByEmail(firestore, user, candidateEventIds = [])`), y
**hoy se llama sin ninguno en los dos sitios reales**. El criterio de éxito 4
del spec —"invitar a un email sin cuenta y registrarse después con ese mismo
email, verificándolo, hace aparecer la invitación en la bandeja sin reenvío
manual"— **no se cumple tal como está esta versión de esta decisión**, y se
deja tachado, no borrado, en
[`SPEC-verificacion-email-invitaciones.md`](../../SPEC-verificacion-email-invitaciones.md).

Resolverlo de verdad exigiría, sin backend:

- (a) un campo indexable adicional en el documento y una regla `allow list`
  filtrada por el propio hash de email — mismo patrón que `events` permite
  `list` vía `memberIds array-contains` — lo que reabre trabajo de reglas ya
  auditado; o
- (b) algún disparador que sí tenga un `eventId` a mano (por ejemplo, un
  enlace de aceptación que hoy no existe).

Se acepta el hueco por ahora, explícitamente, y se deja para una tarea
futura — no se resuelve en esta decisión.

**Otras consecuencias:**

- No reescribe [`0006`](0006-sharing-with-invited-members.md) ni
  [`0007`](0007-client-side-user-directory.md): complementa al segundo, que
  es el que nombró la fuga que esta decisión acota sin cerrar.
- Queda en el backlog, sin bloquear esta decisión, dos hallazgos INFO del
  `security-auditor` sobre `eventInvitesByEmail`: restricción de charset en
  `eventId` (no explotable hoy, sin ningún `match` con wildcard recursivo que
  lo aproveche) y un tope compartido de invitaciones
  (`eventInvites` + `eventInvitesByEmail`) por evento — mismo comportamiento
  ya aceptado hoy en `eventInvites`.
