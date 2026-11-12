# Spec: verificación de email obligatoria e invitaciones sin revelar cuenta

> No sustituye a [`SPEC.md`](SPEC.md). Complementa
> [`docs/adr/0006-sharing-with-invited-members.md`](docs/adr/0006-sharing-with-invited-members.md)
> y [`docs/adr/0007-client-side-user-directory.md`](docs/adr/0007-client-side-user-directory.md),
> sin sustituirlos: la segunda parte de este spec vive dentro de la restricción
> que el ADR 0007 ya fijó — **sin servidor, sin Cloud Functions, sin plan
> Blaze** — y no la reabre. Ambos ADR se referencian, no se reescriben.

## Contexto verificado (no supuesto)

Antes de especificar, se comprobó el código:

- `sendEmailVerification` **sí** se llama al registrarse
  (`infrastructure/firebase/session-adapter.ts:129`), pero **ninguna regla de
  Firestore ni componente del cliente exige `emailVerified`** para crear,
  leer o editar eventos (`firestore.rules:242,252-279`, sin mención de
  `email_verified`; grep de `emailVerified` en `apps/web/src/**` no toca
  `events/` ni `auth/guard.ts`). Hoy sólo gobierna si la entrada del usuario
  se publica en `userDirectory` (`sharing/user-directory.ts:76`) y si puede
  consultarla (`firestore.rules:495-496`).
- Google llega con `emailVerified: true` de fábrica
  (`session-adapter.ts:125`); esta spec no le añade fricción.
- `sharing/share-dialog.ts:491-501` responde hoy *"Nobody with that email has
  an account yet"* cuando el email invitado no está en `userDirectory`. El
  propio ADR 0007 ya documentó esto como una fuga de "oráculo de un email"
  (Consequences, líneas 90-93) y la dejó pendiente de reflejar en política de
  privacidad (F13), sin cerrarla.
- No existe ningún mecanismo de envío de correo en el proyecto: sin Cloud
  Functions, sin plan Blaze (ADR 0007, líneas 14-16, lo excluye explícitamente
  por coste recurrente). Invitar a un email sin cuenta hoy no escribe nada.
- `publishDirectoryEntry` (lo que hace que alguien sea invitable) sólo se
  llama en dos sitios: `infrastructure/firebase/firebase-provider.ts:230`, en cada arranque
  de sesión (`onAuthStateChanged` — login, F5, recuperación de sesión), y
  `profile/profile-view.ts:376`, en el botón "I have verified it" del perfil.
  **No hay detección automática entre pestañas**: el propio código lo
  documenta (`profile-view.ts:349-360`) — verificar el correo en el cliente
  de correo no dispara nada en la pestaña abierta de la app; hace falta
  recargar/volver a entrar, o pulsar ese botón a mano. "Resend email" sólo
  reenvía el correo, no republica nada. En ambos disparadores el
  `emailVerified` que se lee es siempre fresco (no cacheado) y el fallo se
  traga sin bandera persistente, así que se reintenta sin condición en el
  siguiente login. Sin tests: ni `firebase-provider.ts` ni `profile-view.ts`
  ni `user-directory.ts` tienen unitarios propios — sólo `rules/user-directory.test.ts`
  cubre las reglas de Firestore, no este flujo cliente.

## Decisiones ya tomadas para este spec

1. **Verificación de email obligatoria para usar la aplicación** (crear, leer,
   editar eventos), no sólo para el directorio de compartición.
2. **Sin infraestructura de envío de correo nueva.** No se monta Blaze ni
   Cloud Functions. La invitación a alguien sin cuenta se guarda pendiente y
   se resuelve sola si esa persona se registra algún día; no hay notificación
   proactiva por email. Esto es una mejora acotada, no el cierre completo de
   la fuga que describe el ADR 0007 — ver "Lo que esto no resuelve" abajo.

## Objetivo

**Parte A — Verificación de email obligatoria.** Que una cuenta de
email/contraseña sin verificar no pueda crear, leer, ni editar eventos: hoy
puede, y el único efecto de no verificar es no aparecer en el directorio de
compartición. Alcanza a `firestore.rules` y a la UI que hoy asume sesión
iniciada como sinónimo de acceso completo.

**Parte B — Invitar sin revelar si el email existe.** Que el diálogo de
compartir deje de responder distinto según si el email invitado tiene cuenta,
y que invitar a alguien sin cuenta hoy no se pierda: se guarda como oferta
pendiente por email (no por uid) y se reclama automáticamente si esa persona
se registra y verifica su correo más adelante.

## Tech stack

Sin cambios: Lit 3, TypeScript 5.9, Firebase Auth + Firestore (base `planu`),
Vitest 4, Playwright + axe, Biome 2.

## Comandos

```bash
npm run typecheck
npm run lint
npm test                # unitarios
npm run test:rules      # 33 tests de reglas contra emuladores — se amplían
npm run test:e2e
```

`npm run test:rules` es el oráculo real de la Parte A y de la mitad de la B:
cualquier cambio de `firestore.rules` sin un test de reglas que lo agarre no
cuenta como verificado.

## Estructura de proyecto (lo que cambia)

```
firestore.rules
  match /events/{eventId}          + condición email_verified en create/read/update
  match /eventInvitesByEmail/{id}  ← nueva colección, oferta pendiente por hash de email

apps/web/src/
  auth/
    guard.ts                        ya decide redirecciones; añade el caso "sin verificar"
  sharing/
    share-dialog.ts                 ya no distingue el mensaje según exista o no el email
    invitations.ts                  nueva función para ofertar por email cuando no hay uid
    user-directory.ts               nueva función claimPendingInvitesByEmail(),
                                     llamada desde los DOS mismos sitios que
                                     publishDirectoryEntry() y no desde uno nuevo:
                                     firebase-provider.ts:230 y profile-view.ts:376.
                                     Hereda a propósito el mismo hueco conocido de
                                     detección entre pestañas — ver Contexto verificado.
  domain/
    (revisar si isNarrowed/filter-events necesitan saber de "sin verificar";
     probablemente no — es un guard de acceso, no un filtro)

docs/adr/
  0011-verificacion-de-email-obligatoria.md   nuevo
  0012-invitaciones-pendientes-por-email.md   nuevo (o una sola ADR con las dos
                                                mitades — se decide en /plan)
```

## Estilo de código

**Regla de Firestore, siguiendo el patrón ya usado en el fichero** (comentario
que explica el porqué, condición añadida a un `allow` existente sin crear uno
nuevo — recordar que las reglas se combinan con OR):

```
// Sin verificar el correo, la cuenta existe pero no puede usarse: no hay
// evento propio invisible mientras se decide verificar, sólo acceso
// bloqueado hasta hacerlo. Google llega ya verificado (session-adapter.ts:125)
// y nunca lo nota.
function isVerified() {
  return request.auth.token.email_verified == true;
}
```

Y añadida a `isMember()`/`isOwner()`/`allow create`, no como un `allow`
separado.

**Reclamo de invitaciones pendientes**, mismo patrón que `acceptsInvite()`:
el cliente escribe, la regla valida que sólo el dueño del hash de email puede
reclamar su propia oferta pendiente y sólo para convertirla en un
`eventInvites` normal, nunca para inventar una oferta que nadie hizo.

**El reclamo se llama junto a `publishDirectoryEntry`, no en su propio
disparador nuevo** — mismo `catch(() => {})` silencioso, mismo comentario
explicando por qué no debe bloquear el inicio de sesión:

```ts
// Same two call sites as publishDirectoryEntry, deliberately: whatever makes
// someone invitable is exactly what makes a pending-by-email offer of theirs
// resolvable, and duplicating the trigger would just be a second thing that
// could go out of sync with the first.
await claimPendingInvitesByEmail(firestore, user).catch(() => {});
```

## Estrategia de test

- **`test:rules` (emuladores):** por cada condición nueva, un test que la
  activa y otro que la burla y falla — siguiendo el propio estándar del
  fichero ("10 ataques a Firestore, 6 a Storage, todos bloqueados", ver
  AGENTS.md "Estado de seguridad"). Casos mínimos:
  - Cuenta sin verificar no puede `create`/`read`/`update` un evento propio.
  - Cuenta verificada sigue pudiendo, sin regresión.
  - Cuenta de Google (verificada de fábrica) no nota fricción.
  - Reclamar una oferta pendiente que no es la propia falla.
  - Reclamar la propia oferta pendiente, dos veces, no duplica membership.
- **Unitarios (Vitest):** `share-dialog.test.ts` — mismo mensaje de éxito
  exista o no la cuenta; `claim-pending-invites.test.ts` — reclama al
  verificar, no antes.
- **E2e:** el flujo de invitar a un email sin cuenta ya no muestra el error
  actual; si esa persona se registra después con ese email y lo verifica, la
  invitación aparece en su bandeja sin que nadie la reenvíe.

## Fronteras

**Siempre**

- Un único `allow` por operación en `events` — no partir la validación de
  `email_verified` en un `allow` aparte (AGENTS.md, "Estado de seguridad":
  esto ya causó la fuga original del prototipo).
- `security-auditor` en paralelo a `code-reviewer` en `/review`, por tocar
  `firestore.rules` — mandato de AGENTS.md, no opcional para esta tarea.
- El mensaje de éxito al invitar es **idéntico** exista o no la cuenta.
- Ningún ADR aceptado (0006, 0007) se reescribe: esto añade uno nuevo.

**Preguntar primero**

- Si ya hay cuentas reales sin verificar en producción (`planu-app`) con
  eventos creados: la Parte A las bloquearía hasta que verifiquen. Antes de
  desplegar, confirmar si eso es aceptable o si hace falta un aviso previo.
  *(No comprobado en este spec — requeriría acceso de administración, que
  cae en "preguntar primero" igual que el backfill de `memberIds`.)*
- Si las dos partes se implementan como una ADR o dos.

**Nunca**

- Montar Cloud Functions, Blaze, o cualquier envío de correo de terceros como
  parte de esta tarea — es la decisión ya tomada arriba, y revertirla exige
  volver a esta conversación, no una decisión de implementación.
- Prometer que la Parte B cierra la fuga de "oráculo de un email" del ADR
  0007. No la cierra — ver siguiente sección.

## Lo que esto NO resuelve

La Parte B quita el mensaje que hoy revela la respuesta en la interfaz, y
evita perder la invitación cuando el email no tiene cuenta todavía. **No**
elimina que, sin servidor, el propio cliente tiene que consultar
`userDirectory` para saber a qué colección escribir, y esa consulta —según
devuelva un documento o no— sigue siendo observable a nivel de red por quien
inspeccione el tráfico. Es exactamente el límite que el ADR 0007 ya nombró:
*"Forbidding list bounds it, but does not remove it."* Cerrarlo del todo
exige un backend, que es justo lo que la decisión de esta conversación
descarta por ahora. Esto se documenta explícitamente para que nadie lea
"arreglado" donde el spec dice "acotado".

**Descubierto durante la implementación de T63, no anticipado por este
spec: el reclamo automático no funciona hoy.** `eventInvitesByEmail` prohíbe
`list` a propósito (mismo motivo que `userDirectory`: separar "comprobar una
dirección conocida" de "censar la colección entera"), lo que significa que
el cliente sólo puede hacer `get()` de un id si ya conoce el `eventId` de
antemano. Ninguno de los dos disparadores de `claimPendingInvitesByEmail()`
—arranque de sesión, botón "I have verified it"— tiene un `eventId` en
contexto: disparan de forma global, no dentro de un evento concreto. La
función se implementó aceptando una lista explícita de `eventId` candidatos
(`candidateEventIds`), y **hoy se llama sin ninguno en los dos sitios
reales** — es decir, es un no-op documentado en producción. El criterio de
éxito 4 de más abajo ("la invitación aparece en la bandeja sin reenvío
manual") **no se cumple tal como está esta versión de la Parte B**. Resolverlo
de verdad exigiría, sin backend: (a) un campo indexable adicional en el
documento y una regla `allow list` filtrada por el propio hash de email
—mismo patrón que `events` permite `list` vía `memberIds array-contains`—,
lo que reabre trabajo de reglas ya auditado; o (b) algún disparador que sí
tenga un `eventId` a mano (p. ej. un enlace de aceptación que hoy no existe).
Decisión explícita: se acepta el hueco por ahora y se deja para una tarea
futura, no se resuelve en esta pasada.

## Criterios de éxito

1. `npm run test:rules` en 0, con los nuevos tests de la lista arriba en
   verde y ninguno de los 33 existentes roto.
2. Una cuenta de email/contraseña sin verificar no puede crear ni leer
   eventos propios; una vez verificada, puede, sin volver a iniciar sesión.
3. `share-dialog.ts` da el mismo mensaje de éxito exista o no la cuenta
   invitada.
4. ~~Invitar a un email sin cuenta y registrarse después con ese mismo
   email, verificándolo, hace aparecer la invitación en la bandeja sin
   reenvío manual.~~ **No cumplido, a sabiendas.** Ver "Lo que esto NO
   resuelve" — sin un `eventId` en contexto en ninguno de los dos
   disparadores, `claimPendingInvitesByEmail()` es hoy un no-op documentado.
   Tachado y no borrado, para que quede constancia de que se evaluó y no de
   que se olvidó.
5. Dos ADR nuevos (o uno cubriendo ambas mitades) documentando las dos
   decisiones, sin reescribir 0006 ni 0007.
6. `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` en
   código de salida 0.

## Bug confirmado en producción durante esta sesión

Comprobado directamente contra Firebase (Identity Toolkit + Firestore,
proyecto `planu-app`, base `planu`), no supuesto: una cuenta real
(`yogarciag@hotmail.com`) tiene `emailVerified: true` en Firebase Auth y el
cliente ya no muestra el aviso de verificación, pero **`userDirectory` no
tiene ninguna entrada para su email** (404 al consultar el hash exacto).

`lastRefreshAt` de esa cuenta es idéntico, al milisegundo, a `createdAt`: el
token de esa sesión nunca se ha reemitido desde la creación de la cuenta.
Como `firestore.rules:495-496` exige `request.auth.token.email_verified`
—el claim del token, no el estado real de la cuenta—, toda escritura al
directorio con ese token se deniega por regla, y los tres puntos que la
intentan la tragan en silencio: `firebase-provider.ts:230-232`,
`profile-view.ts:378-380 dentro de #onCheck`, y el propio
`publishDirectoryEntry`.

**El fallo de diseño que lo hace irreversible desde la UI:**
`profile-view.ts:372` hace `this.user = refreshed` —lo que oculta el aviso,
`#renderVerificationNotice` en la línea 326 sólo mira `user.emailVerified`—
**antes** de intentar publicar en el directorio, en la línea 376. Si esa
publicación falla, el aviso ya ha desaparecido y con él la única vía de la
interfaz para reintentarlo. La única salida que queda hoy es cerrar sesión y
volver a entrar, porque eso fuerza un token completamente nuevo.

Esto es un bug de esta sesión de trabajo, previo e independiente de las
Partes A y B, pero las toca directamente: la Parte B reclama invitaciones
pendientes en los mismos disparadores que fallan aquí, así que hereda el
mismo hueco. Se añade a esta spec como corrección obligatoria, no opcional,
antes de dar la Parte B por completa:

1. `#onCheck` no debe ocultar el aviso hasta que `publishDirectoryEntry` haya
   tenido éxito, no sólo hasta que `emailVerified` sea `true`.
2. Si la publicación falla, el aviso debe seguir ofreciendo un reintento, en
   vez de desaparecer para siempre.
3. Instrumentación mínima (ver más abajo) para poder distinguir "denegado
   por regla" de "documento no existe" y de "sin conexión", en vez de un
   `catch(() => {})` idéntico para los tres.

## Preguntas abiertas

- **Fiabilidad real de "recargar/volver a entrar" como disparador**, no sólo
  del botón "I have verified it". Un caso real en producción
  (`yogarciag@hotmail.com`, verificado y con recarga posterior) no llegó a
  publicarse en el directorio — evidencia de que ese disparador puede no ser
  tan fiable como asumía la primera lectura del código, y **no hay ningún
  test, unitario ni de reglas, que lo confirme en ningún sentido** (ni
  `firebase-provider.ts` ni `session-adapter.ts` ni `user-directory.ts`
  tienen cobertura de este flujo completo). Antes de dar la Parte B por
  cerrada, esto necesita: (a) un test que reproduzca "verificar + F5" y
  compruebe si publica o no, y (b) si no publica, decidir si el reclamo de
  invitaciones pendientes debe depender también del botón explícito del
  perfil, o si hace falta un tercer disparador más fiable — lo cual sí sería
  una decisión de diseño nueva, no sólo enganchar al mecanismo existente
  como proponía este spec.
  - Fix menor y de bajo riesgo, aparte de la Parte B: en
    `sharing/user-directory.ts`/`share-dialog.ts`, distinguir
    `permission-denied` de "documento no existe" en `findUserByEmail`, para
    que un fallo de permisos no salga disfrazado del mismo mensaje que "no
    hay cuenta" — hoy ambos casos son indistinguibles para quien invita.
- Cuentas ya existentes sin verificar en producción — ver "Preguntar primero".
- Si el guard de `auth/guard.ts` redirige a una pantalla explicando "verifica
  tu correo" o reutiliza el banner ya existente de `profile-view.ts` en un
  sitio nuevo (fuera del perfil, donde hoy vive) — se decide en `/plan`.
- Nombre exacto y forma del documento en `eventInvitesByEmail`: ¿guarda el
  email en claro (para que el owner vea a quién invitó, como ya hace
  `eventInvites.inviteeEmail`) o sólo el hash? Guardar el email en claro ahí
  es coherente con lo que ya hace `eventInvites`, pero es una superficie
  nueva que revisar con `security-auditor` antes de fijarla.
