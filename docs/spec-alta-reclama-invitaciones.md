# Spec · Que el alta reclame las ofertas por email pendientes (GH-280)

> Es una especificación, no cambia código, reglas ni configuración. No sustituye
> a [`SPEC.md`](../SPEC.md). Escrita el 2026-11-15 contra `origin/main` en
> `e195080`. Lo comprobado en el código lleva fichero y línea; lo que no se ha
> podido comprobar va marcado como «verificar».

## Objetivo

Que una persona a la que se invitó por email antes de tener cuenta, y que
después se registra (o entra) con **ese mismo email ya verificado**, encuentre
la invitación en su bandeja sin que quien invitó tenga que repetirla, y sin que
nadie —ni quien invita ni un tercero— pueda saber por el camino si ese email
tiene cuenta (ADR 0012).

Es lo que permite que la landing prometa «invita a quien aún no tiene cuenta»
(D12, #271/#273) y lo que da sentido al aviso por email sin servidor de la fase 1
de [`spec-email-invitaciones.md`](spec-email-invitaciones.md) (GH-282): un
enlace que lleva a una cuenta sin nada que ver no sirve de nada.

## Veredicto sobre la issue: está mal planteada en dos puntos

El texto de la issue («el alta no reclama las ofertas pendientes») es cierto en
el resultado, pero el diagnóstico implícito no lo es.

1. **En `main` no existe ninguna función de reclamo.** `claimPendingInvitesByEmail`
   no aparece en ningún `.ts` de `apps/` (búsqueda en todo el árbol de
   `origin/main`). Solo aparece en prosa: `docs/adr/0012-…md` (que la sitúa en
   `sharing/user-directory.ts` y en `firebase-provider.ts:292-304`),
   `SPEC-verificacion-email-invitaciones.md` y `tasks/todo.md` (T63, «cerrado»).
   Hoy `firebase-provider.ts:326` solo llama a `sharing.publishDirectoryEntry(...)`
   y `profile-view.ts:379` solo a `sharing.publishDirectoryEntry(refreshed)`;
   ninguno reclama nada. La función solo existió en la rama sin fusionar
   `feat/claim-email-invites` (commits `40338b4`, `15db0dc`, `7b867e6`; ninguno
   es ancestro de `main`: comprobado con `git merge-base --is-ancestor` y
   `git branch -a --contains`). El ADR 0012 describe, pues, código que **no está
   en `main`**. Nota para el responsable: conviene corregir esa prosa (rodaja 4).
2. **Aun existiendo, no habría reclamado nada.** El propio ADR 0012,
   consecuencia (b), lo dice: la función de la rama se llamaba sin ningún
   `eventId` candidato («no-op documentado en producción»), porque el invitado
   no puede listar sus ofertas. El problema de fondo no es **cuándo** se
   dispara el reclamo sino que **el invitado no tiene forma de descubrir qué
   ofertas tiene**. Disparar «en el alta» o «en cada arranque» da igual: la
   consulta que haría falta está denegada por reglas.

Lo que sí es cierto: no hay reclamo, y la ruta de reglas para reclamar sí está
hecha y probada (ver abajo). Falta la mitad cliente y, sobre todo, la forma de
descubrir.

## Estado actual medido en el código

### Reglas (`firestore.rules`)

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| `isVerified()` | `:8` | Lee `request.auth.token.email_verified` (claim del token, ADR 0011). |
| Crear oferta | `:614` (`allow create`) con `isValidOffer` `:564` | Solo el dueño verificado del evento, en su nombre, a hora de servidor, y no a un miembro (`isToAMember`, `:607`). Campos permitidos: `eventId, eventTitle, inviteeEmail, invitedBy, invitedByName, role, createdAt`; el id debe ser `{eventId}_{sha256(email)}`. |
| Leer una oferta | `:600` (`allow get`) | El remitente verificado, o el invitado verificado (`isInvitee`, `:579`, compara hash del email del documento con el del token). Un id **inexistente** solo se puede leer si acaba en el hash del propio email del que pregunta (`isOwnMissingId`, `:589`): así nadie sondea direcciones ajenas. |
| Listar ofertas | `:602` (`allow list: if isSender()`) | **Solo el remitente**, y solo con filtro propio por `invitedBy`. El invitado **no puede listar**. El comentario de `:594-599` lo nombra: «granting the invitee a list filtered on their own address is ADR 0012's open option (a), not decided here». |
| Reclamar | `claimsOffer` `:454` y rama en `allow create` de `eventInvites` `:493-501` | Mitad «crear `eventInvites/{eventId}_{uid}`» copiando la oferta campo a campo y exigiendo `!existsAfter(offerPath)`, es decir, que el mismo lote borre la oferta. Mitad «borrar la oferta»: la autoriza `isInvitee` (`:579`). |
| Lápida | `writesTombstone` `:472` | Mientras existe `eventInvites/{eventId}_{uid}` con `status: 'removed'`, el id está ocupado: el reclamo (un `create`) falla (ADR 0015). |

Pruebas de reglas del reclamo ya existentes: `apps/web/rules/event-invites-by-email.test.ts:219-275`
(reclama el titular verificado, una vez; solo dentro del mismo lote que gasta la
oferta; no sin verificar ni con otro email ni para otro uid; copia exacta; no si
quien invitó ya no es dueño). Origen: `a8749d3` (GH-115, #148).

### Cliente

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Alta con email y contraseña | `infrastructure/firebase/session-adapter.ts:118-138` | Crea la cuenta y envía `sendEmailVerification` (`:134`). No toca invitaciones. La cuenta nace **sin verificar**. |
| Guardia | `auth/guard.ts:43,49` | Una sesión con email sin verificar solo puede ir a `/app/profile` (ADR 0011). |
| Arranque de sesión | `infrastructure/firebase/firebase-provider.ts:326` | `publishDirectoryEntry(sessionUser)` y nada más. Aquí cabe el reclamo para quien ya llega verificado (Google, o email ya verificado). |
| «Ya lo verifiqué» | `profile/profile-view.ts:379` | Tras `refreshEmailVerification()` (token reemitido) publica la entrada y nada más. Es el primer instante en que una cuenta de email/contraseña recién creada tiene un token con `email_verified: true`. |
| Bandeja | `sharing/invitations-inbox.ts:84` | `watchReceivedInvites(uid)` escucha `eventInvites` con `inviteeUid == uid` y `status == 'pending'`. Cualquier reclamo que cree la invitación aparece sola: no hace falta UI nueva. |
| Aceptar | `invitations-inbox.ts:140` → `sharing-adapter.ts:267` | Con `email`, además gasta la oferta del mismo evento (ADR 0014). Ya lee la oferta por id conocido (`:274-280`). |
| Ofrecer | `sharing-adapter.ts:196-224` | `setDoc` de la oferta con los siete campos, sin campo de hash. |
| Puerto | `application/ports/sharing.ts:70-139` | No tiene método de reclamo. |

### Cuándo se dispara hoy el reclamo

Nunca: no hay código. Y por diseño de reglas **el alta no puede reclamar**: en el
momento del alta la cuenta no está verificada, `isVerified()` es falso, y tanto
`allow create` de `eventInvites` (`:493`) como `isInvitee` (`:579`) lo exigen. La
fila «email aún sin verificar en el alta» de la pregunta es, por tanto, real y
correcta, pero no es un defecto: es el ADR 0011 funcionando. El instante correcto
no es «el alta» sino **el primer token con `email_verified: true`**.

## Qué falla de verdad

1. **Falta la mitad cliente del reclamo** (nadie la llama, ni siquiera existe en
   `main`).
2. **Falta el descubrimiento.** La oferta tiene id `{eventId}_{hash}`. Quien
   reclama solo puede hacer `get` de un id que ya conoce; no conoce el `eventId`.
   No hay `list` para el invitado (`firestore.rules:602`). Este es el bloqueo
   real, y el ADR 0012 ya lo nombró como «opción (a)».
3. **Falta el disparador en el momento justo**, que no es el alta sino la
   verificación (`profile-view.ts:379`) y cada arranque (`firebase-provider.ts:326`).
4. (Secundario) La prosa del ADR 0012 y de `tasks/todo.md` describe como hecho lo
   que no está en `main`.

## Opciones

| | Qué | A favor | En contra |
| --- | --- | --- | --- |
| A | **Solo enlace**: el aviso de GH-282 lleva el `eventId` y el cliente hace `get` del id propio tras entrar | Sin cambios de reglas; encaja con la fase 1 | Solo reclama quien abre **ese** enlace en **ese** dispositivo; quien se registra por su cuenta, o pierde el enlace, no ve nada. No cumple el objetivo |
| B | **Campo `emailHash` en la oferta + `allow list` para el titular verificado** filtrado por su propio hash (opción (a) del ADR 0012) | Cierra el hueco; patrón ya usado (`events` con `memberIds array-contains`); un solo campo; el reclamo reutiliza las reglas ya probadas | Toca reglas ya auditadas (hay que repetir la revisión); las ofertas antiguas no tienen el campo |
| C | Reorganizar como `eventInvitesByEmail/{hash}/offers/{eventId}` y permitir `list` por ruta | Sin campo nuevo; el aislamiento lo da la ruta | Migración de todas las ofertas y de las reglas de borrado de cuenta (`account-data`); más superficie que B |
| D | Cloud Function que reclame al crearse la cuenta | Sin tocar el modelo | Exige Blaze: descartada por el responsable (ADR 0007/0012) |

## Recomendación

**B, complementada por A cuando exista el enlace de GH-282** (el enlace sigue
siendo útil para las ofertas antiguas, que no tendrán el campo; ver «Ofertas
antiguas»).

Diseño:

1. **Campo `emailHash`** (hex minúscula de sha256 del email en minúscula) en el
   documento de la oferta. Se valida en creación: `d.emailHash == emailHash(d.inviteeEmail)`
   y entra en el `hasOnly` de `isValidOffer`. El id ya impone la misma relación
   (`:572`), así que **el campo no revela nada que el id no revele ya**.
2. **`allow list`** pasa de `isSender()` a `isSender() || isOwnHash()`, donde
   `isOwnHash()` exige `isVerified()`, email presente y
   `resource.data.emailHash == emailHash(request.auth.token.email)`. Una consulta
   `where('emailHash','==', miHash)` es la única que pasa; cualquier otra
   (sin filtro, o con el hash de otro) se deniega igual, sea cual sea el
   contenido. La denegación no depende de si existen ofertas: no hay oráculo.
   **Verificar contra el emulador** que Firestore acepta la unión de las dos
   ramas con las dos formas de consulta (remitente por `invitedBy`, titular por
   `emailHash`), sin pedir índice compuesto y sin romper `emailOfferTo`
   (`sharing-adapter.ts:73-89`) ni el borrado de cuenta.
3. **`claimPendingOffers(user)`**, método nuevo del puerto `SharingPort` y de su
   adaptador (`sharing-adapter.ts`): lista las ofertas del propio hash (con
   `limit` acotado) y, **por cada una, un lote independiente** `delete(oferta)` +
   `set(eventInvites/{eventId}_{uid})` copiado campo a campo, como el test
   `event-invites-by-email.test.ts:234-240`. Un lote por oferta, no uno para
   todas: una oferta que no se pueda reclamar (lápida, evento borrado, otra
   invitación ya en ese id) no debe hundir las demás. Cada fallo se traga y pasa
   por `record(...)` como ya hace `publishDirectoryEntry`
   (`sharing-adapter.ts:377-380`).
4. **Disparadores: los dos que ya existen, sin un tercero.**
   `firebase-provider.ts:326`, a continuación de `publishDirectoryEntry`, y
   `profile-view.ts:379` tras publicar, antes de asignar `this.user`. Solo se
   llama con un `SessionUser` cuyo `emailVerified` sea verdadero (en la segunda
   ruta el token ya se reemitió: `profile-view.ts` documenta `getIdToken(true)`).
   **Ni el alta ni el arranque de un usuario sin verificar reclaman** (las reglas
   lo denegarían de todos modos).
5. **El reclamo no acepta.** La oferta se convierte en `eventInvites` con
   `status: 'pending'`; la persona decide en su bandeja
   (`invitations-inbox.ts:84`). Es la semántica del ADR 0012 («se une cuando la
   acepta») y no regala acceso a una cuenta recién creada.

### Ofertas antiguas (sin `emailHash`)

Las ofertas creadas antes del cambio no aparecerán en la consulta. Opciones, a
decidir (pregunta 3): (i) no hacer nada y que el enlace de GH-282 (acceso por
`get` de id conocido) las cubra; (ii) que quien invita las reemita (el diálogo ya
sabe reofrecer: `sharing-adapter.ts:196-224`); (iii) un único script de
migración con credenciales de administración, que cae en «preguntar primero»
(`AGENTS.md`). Cuántas hay en producción: **verificar** (requiere acceso de
lectura a `planu-app`, que esta sesión no tiene).

## Cambios previstos

### `firestore.rules` (en la rodaja 1; esta spec no los toca)

- `isValidOffer`: `emailHash` en `hasOnly`; `d.emailHash is string` y
  `d.emailHash == emailHash(d.inviteeEmail)`.
- `allow list`: `isSender() || isOwnHash()` (función nueva, mismo estilo que
  `isOwnMissingId`).
- Sin cambios en `claimsOffer`, `writesTombstone`, `isInvitee` ni en los `delete`.
- Actualizar el comentario de `:594-599` (la opción (a) pasa a estar decidida) y
  `docs/backend.json` (colección `eventInvitesByEmail`, `:206`).

### Puertos y adaptadores

- `application/ports/sharing.ts`: un método, `claimPendingOffers(user: SessionUser): Promise<number>`
  (cuántas reclamó; útil para pruebas y registro, no para la interfaz).
- `infrastructure/firebase/sharing-adapter.ts`: implementación, y `offerInviteByEmail`
  (`:196`) añade `emailHash` al documento.
- `firebase-provider.ts:326` y `profile-view.ts:379`: una llamada cada uno.
  `profile-view.ts` ya solo habla con el puerto (sin importar Firebase).

### `TOPE_ACOPLADOS = 24` no puede subir

`apps/web/arch/boundary.test.ts:242` fija 24 ficheros acoplados a Firebase y la
aserción «no crece» está en `:305`. Este cambio **no necesita un fichero nuevo
que importe `firebase/*`**: el puerto no importa Firebase, y la lógica nueva
vive en `sharing-adapter.ts`, que ya está exento. Reglas para no romperlo:

- No crear un fichero con `import … from "firebase/firestore"` fuera de la lista
  de exentos. Si el adaptador crece demasiado, extraer solo funciones puras
  (construir el documento de la invitación a partir de la oferta) en un fichero
  **sin** imports de Firebase.
- No importar Firebase desde `profile-view.ts` ni `firebase-provider.ts` más de
  lo que ya hacen.
- Comprobación: `npm run test:arch` (el test «no crece» y «cubre todo lo que hoy
  importa Firebase»). **Verificar** que sigue en 24 al final de cada rodaja.

## Riesgos de privacidad (ADR 0012)

Principio: ninguna respuesta del sistema puede distinguir «este email tiene
cuenta» de «no la tiene» para alguien que no sea el titular.

| Riesgo | Mitigación prevista | Estado |
| --- | --- | --- |
| Un tercero lista ofertas ajenas o sondea qué direcciones tienen oferta | `list` solo con filtro de **mi** hash y verificado; `get` de id inexistente solo si acaba en mi hash (`:589`) | A probar con regla que debe denegar (abajo) |
| El campo `emailHash` revela más que el id | No: el id ya contiene el mismo hash (`:572`) | Razonado, **verificar** con la prueba de igualdad |
| El reclamo sirve de oráculo («reclamo y veo si tenía cuenta») | El reclamo solo opera sobre mi propio hash y mi propio token; no devuelve nada sobre otras direcciones | Razonado |
| Registrar el email de otra persona sin verificar para robar sus invitaciones | Las reglas exigen `email_verified` en token (`:8`, `:579`, `:493`); el alta sola no da nada | Ya probado en `event-invites-by-email.test.ts:251` |
| La fuga de red del ADR 0007/0012 (consulta a `userDirectory` al invitar) | **No se cierra aquí.** Sin servidor sigue observable; es el límite ya aceptado | Fuera de alcance, repetido para que nadie prometa lo contrario en la landing |
| El enlace de GH-282 | No lleva email ni identificador de la persona; no da acceso por sí mismo (`spec-email-invitaciones.md`) | Compatible |
| Ofertas que no caducan (ADR 0014) | Una dirección reutilizada hereda ofertas viejas: ya aceptado; el reclamo no lo agrava, pero lo hace más visible. Ver pregunta 4 | Abierto |
| Mensajes de error | El reclamo no muestra errores a la persona; una oferta no reclamable es silenciosa. No se escribe «te invitaron a X pero falló» | A fijar en la rodaja 2 |

## Pruebas

Reglas (`npm run test:rules`, emulador), en `apps/web/rules/event-invites-by-email.test.ts`:

- **Debe denegar (la que importa):** el titular verificado **no puede listar sin
  filtro** (`getDocs(collection(db,'eventInvitesByEmail'))`) ni con
  `where('emailHash','==', hashAjeno)`; un verificado ajeno no obtiene ninguna
  oferta consultando por **mi** hash; un titular **sin verificar** consultando
  por su propio hash; un usuario sin email en el token. Y la misma consulta por
  hash propio sin ofertas debe devolver vacío, no error (la denegación no
  depende del contenido).
- Debe permitir: el titular verificado lista por su hash y ve solo las suyas; el
  remitente sigue listando por `invitedBy` (no regresión de `emailOfferTo` ni
  del borrado de cuenta, `account-data-adapter.test.ts:214`).
- Creación: se rechaza una oferta sin `emailHash`, con `emailHash` distinto del
  hash de `inviteeEmail`, o con mayúsculas; se acepta la correcta.
- No regresión: todos los tests de `:219-275` (reclamo) y `stale-email-offer.test.ts`.
- Prueba de «carga»: revertir `isOwnHash()` y comprobar que el test de la
  consulta propia falla; revertir la igualdad del hash y comprobar que el de
  creación falla (mismo criterio que usó el ADR 0011).

Unitarias (`sharing-adapter.test.ts`, mocks como los de `:183`, `:334`):

- Reclama todas las ofertas del propio hash, una por lote, y borra cada oferta
  en su lote.
- Una oferta que falla (lápida, id ocupado) no impide las demás y no lanza.
- No hace ninguna consulta si el usuario no está verificado ni tiene email.
- Una prueba estructural, estilo `15db0dc` (`claimPendingInvitesByEmail() call sites`):
  `claimPendingOffers` se llama **exactamente** en `firebase-provider.ts` y
  `profile-view.ts`, y en ningún tercer sitio.

E2E (`apps/web/e2e/sharing.spec.ts`, emulador aislado): A invita a B (sin cuenta)
→ B se registra → verifica → la invitación aparece en su bandeja sin reenvío →
acepta y entra. Y el caso negativo: B se registra **sin** verificar y no ve nada.
Los e2e de este repo son inestables (`spec-ci-e2e-reliability.md`): **verificar**
que se ejecutan en verde antes de declarar cumplido el criterio.

Arquitectura: `npm run test:arch` con `TOPE_ACOPLADOS = 24` intacto.

## Rodajas (cada una ≤200 líneas, con pruebas)

1. **Reglas y su batería de pruebas.** `emailHash` en la creación, `allow list`
   del titular, tests de `rules/` incluidos los que deben denegar. Solo
   `firestore.rules`, `docs/backend.json` y `rules/*.test.ts`. No se despliega
   hasta pasar la revisión de seguridad de reglas.
2. **Escritura con el campo y reclamo en el adaptador.** `offerInviteByEmail`
   guarda `emailHash`; método del puerto y adaptador `claimPendingOffers`; tests
   unitarios. Sin disparadores todavía (inerte, fácil de revertir). Orden de
   despliegue: reglas primero, cliente después (un cliente nuevo contra reglas
   viejas fallaría al crear ofertas: **verificar** el orden con el despliegue
   continuo del ADR 0004).
3. **Disparadores.** Una llamada en `firebase-provider.ts:326` y otra en
   `profile-view.ts:379`, prueba estructural de sitios de llamada, e2e del
   flujo completo. `TOPE_ACOPLADOS` sin cambios.
4. **ADR 0017 y corrección de prosa.** Nuevo ADR (supersede parcialmente el 0012,
   consecuencia (b)): campo, `list` del titular, disparadores y límites.
   Corregir la ubicación errónea de la función en el 0012 y marcar T63 en
   `tasks/todo.md`. Actualizar la landing (`docs/landing-revision-diseno.md`)
   solo en lo que ya sea verdad.
5. **(Opcional, según pregunta 3) Ofertas antiguas.** Reemisión desde el diálogo
   o plan de migración. No entra sin decisión.

## Preguntas abiertas para el responsable

1. **¿Se aprueba B** (campo `emailHash` + `list` del titular) y reabrir las
   reglas de `eventInvitesByEmail` para una nueva revisión de seguridad, o se
   prefiere C (colección anidada por hash, más migración)?
2. **¿`emailHash` obligatorio en la creación?** Obligatorio hace fallar, de forma
   visible, a un cliente antiguo que ofrezca por email tras el despliegue de
   reglas; opcional deja ofertas silenciosamente irreclamables. La spec recomienda
   obligatorio (fallo ruidoso mejor que silencioso).
3. **Ofertas antiguas**: ¿se dejan a su suerte (cubiertas solo por el enlace de
   GH-282), se reemiten, o se migran con credenciales de administración? ¿Cuántas
   hay en `planu-app`? (**verificar**; esta sesión no tiene acceso).
4. **Caducidad**: ¿es el momento de que las ofertas caduquen (retención sin
   decidir en `firestore.rules:549-551` y ADR 0014 «residual»)? Reclamar una oferta
   de hace un año a una dirección reutilizada es el peor caso.
5. **¿El reclamo debe avisar a la persona?** Hoy la propuesta es silencioso: la
   invitación simplemente aparece en la bandeja. ¿Se quiere un aviso (p. ej. «tienes
   2 invitaciones») sin revelar nada más?
6. **Borrado de cuenta del titular**: las ofertas dirigidas a su dirección no se
   borran con su cuenta (el borrado actual solo cubre las enviadas,
   `application/ports/account-data.ts:60`; **verificar**). ¿Se acepta, o hay que
   cubrirlo por `emailHash` ahora que el titular puede listarlas?
7. **Corrección del ADR 0012 y `tasks/todo.md`**: describen un reclamo que no está
   en `main`. ¿Se corrigen en esta línea de trabajo (rodaja 4) o aparte?
8. **Rama `feat/claim-email-invites`**: ¿se descarta (la rodaja 2 reimplementa lo
   útil con el campo) o se recupera partiendo de ella? **Verificar** su estado
   con quien la abrió; no se ha tocado.
