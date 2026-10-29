# Spec: compartir eventos por enlace (borrador, sin especificar aún)

> Anotado durante la sesión que dio lugar a
> `SPEC-verificacion-email-invitaciones.md`, a petición explícita de
> mantenerlo en un spec separado. **No se ha pasado por el ciclo de
> preguntas de `/spec` todavía** — esto es sólo la idea, para no perderla,
> no una especificación lista para `/plan`.

## Idea de partida

Compartir un evento hoy exige conocer el email de la persona invitada
(`sharing/share-dialog.ts`, ver `SPEC-verificacion-email-invitaciones.md`).
La alternativa propuesta: generar un **enlace de invitación** para el evento;
quien entra con ese enlace (con sesión iniciada, presumiblemente) queda
compartido con el evento automáticamente, sin que el propietario tenga que
saber ni escribir ningún email.

## Por qué merece su propio spec y no es una extensión trivial

Toca decisiones que la invitación por email ya resolvió de una forma que un
enlace no resuelve igual, y que no deberían improvisarse al implementar:

- **¿El enlace es de un solo uso o reutilizable?** Un enlace reutilizable
  compartido sin querer (capturas de pantalla, reenvíos) invita a cualquiera
  que lo tenga, sin el control de "un email, una persona" que tiene el
  modelo actual.
- **¿Caduca?** Sin caducidad, un enlace de hace un año sigue siendo una
  puerta abierta al evento.
- **¿Con qué rol entra quien lo usa** — `viewer`, `editor`, elegido al
  generarlo? El modelo actual de `roles` en `firestore.rules` asume que cada
  entrada la decide el owner por persona; un enlace decide el rol de
  antemano para quien sea.
- **¿Se puede revocar** sin invalidar también las membresías ya aceptadas
  por ese enlace?
- **Tope de 21 miembros por evento** (`isValidMembership`, `firestore.rules:56-66`):
  un enlace que cualquiera puede reenviar hace mucho más fácil llenarlo sin
  querer o a propósito.
- Relación con la Parte B de `SPEC-verificacion-email-invitaciones.md`: si
  ambos mecanismos conviven, hay que decidir si el enlace sigue exigiendo
  email verificado como la Parte A, o si es una vía distinta con sus propias
  reglas.

## Siguiente paso

Pasar esto por `/spec` completo cuando toque priorizarlo: empezando por las
preguntas de arriba, no asumiéndolas.
