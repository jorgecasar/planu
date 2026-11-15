# 0015 · Quien sale de un evento deja una lápida en su invitación

- **Fecha:** 2026-11-12 · **Estado:** aceptado; decisión del responsable del producto (opción A de GH-147)
- **Supersede parcialmente:** [0013](0013-borrado-de-invitaciones-con-la-cuenta.md), sólo el borrado por parte del invitado · **Cierra:** el residual T5 del [0014](0014-ofertas-por-email-se-gastan-al-unirse.md) · **Issue:** GH-147

## Contexto

El 0014 gasta la oferta por email al expulsar buscando la dirección que
guarda la invitación del expulsado. Ese dato no basta:

- **T5.** Un miembro borra su entrada de `userDirectory`, el dueño le ofrece
  el evento por email sin que `isToAMember` lo vea, y el miembro borra su
  invitación (lo permitía el 0013): la expulsión no encuentra la dirección.
- **Cambio de email.** El miembro cambia a otra dirección con
  `verifyBeforeUpdateEmail()` y borra la entrada nueva del directorio. La
  oferta va a la dirección nueva y la expulsión busca la antigua.
- **Salida voluntaria.** Quien sale borra su invitación y reclama una oferta
  que el dueño le envió mientras era miembro, quizá con más rol.

En los tres casos la oferta sobrevive y el expulsado vuelve a entrar.
Cualquier arreglo que dependa de la dirección hereda el mismo hueco.

## Decisión

Se bloquea por uid, no por dirección. El lote que saca a alguien de un evento
escribe en `eventInvites/{eventId}_{uid}` una lápida: `status: 'removed'`,
`eventId`, `inviteeUid`, `invitedBy` (el dueño) y `decidedAt` del servidor,
sin email. La escribe el dueño al expulsar y el propio invitado al salir;
las reglas sólo la aceptan en un lote que lo saca de `memberIds`.

- Mientras la lápida existe, el id está ocupado: reclamar una oferta por email
  es un `create` y falla para cualquier dirección.
- El invitado no puede modificarla ni borrarla mientras el evento exista.
  Sólo el dueño la convierte de nuevo en una invitación pendiente, al volver a
  invitar por uid.
- **Salir y expulsar exigen la lápida: lo imponen las reglas**, en
  `leavesTheEvent()` y en la rama del dueño con `removesWithTombstone()`, que
  además limita la expulsión a un invitado por escritura. Así tampoco expulsa
  sin lápida una pestaña del dueño con un cliente anterior.
- Gastar la oferta con la dirección de la invitación se mantiene, como
  limpieza.

Así el cliente ya no necesita borrar las invitaciones recibidas después de
abandonar los eventos. El código ya lo hacía en ese orden, y ahora no importa.
El borrado de cuenta no intenta borrar las lápidas: no puede saber si el
evento sigue en pie, y en el e2e de T32 un borrado denegado hacía fallar el
borrado entero antes de llegar a la cuenta de Auth. Sin ese intento, llega
siempre a borrarla.

Se descarta la regla de la versión anterior de esta propuesta, que impedía al
miembro borrar su invitación mientras siguiera en el evento. Con lápidas no
hace falta, y quitarla elimina el bloqueo que provocaba: un miembro con la
verificación revocada no puede salir, pero sí borrar su invitación, y el
borrado de su cuenta llega a término. Lo comprueba un test de reglas.

## Consecuencias

- T5, el cambio de email y la salida voluntaria quedan cerrados. Hay un test
  de reglas por cada caso.
- **Retención.** El uid de quien fue expulsado o salió queda en `eventInvites`
  para ese evento, sin email. Borrar el evento no borra la lápida: después,
  las reglas dejan borrarla al invitado, aunque la aplicación no lo hace, y
  se borra con la cuenta del dueño, que elimina las invitaciones que envió.
  Tras borrar su cuenta, la lápida del invitado conserva su uid ya muerto, el
  `eventId`, el uid del dueño y la fecha: datos seudónimos, que siguen ahí
  hasta que el dueño borre su cuenta.
- Un miembro verificado puede salir siempre, salvo en un evento a medio
  migrar sin `roles` en el que quede algún otro invitado: ese límite ya
  existía y lo fija el test «only the last guest can leave a half-migrated
  event until the roles backfill».
- El dueño puede borrar la lápida, y con ello deja volver al expulsado. La
  interfaz no ofrece esa acción.
- Expulsar y salir cuestan una lectura más: el evento, para conocer al dueño
  que nombra la lápida.

## Residuales abiertos

Pendientes de decisión del responsable del producto; no se implementa
ninguno.

- **(c′)** El dueño readmite por uid y después cancela la invitación desde el
  diálogo. Cancelar borra el documento, la lápida desaparece con él y una
  oferta por email antigua vuelve a dejar entrar a esa persona.
- **(c)** Readmitido por uid, el invitado borra la invitación pendiente y
  reclama una oferta por email anterior a la expulsión, con el rol de esa
  oferta. El dueño consintió su vuelta, aunque no ese rol.
