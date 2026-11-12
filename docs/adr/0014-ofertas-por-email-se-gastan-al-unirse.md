# 0014 · Una oferta por email se gasta al unirse, al invitar por uid y al expulsar

- **Fecha:** 2026-11-11 · **Estado:** aceptado; reglas revisadas en #168 y #169
- **Complementa a:** [0012](0012-invitaciones-pendientes-por-email.md) y [0013](0013-borrado-de-invitaciones-con-la-cuenta.md) · **Issue:** GH-147

## Contexto

Una oferta en `eventInvitesByEmail` no caduca y sobrevivía a que su
destinatario entrase en el evento por uid. Expulsado después, el invitado
borraba su propia invitación (lo permite el 0013) y reclamaba la oferta
olvidada para volver a entrar, incluso con un rol del que le habían bajado.
Las reglas no ven un registro borrado, así que no pueden saber que ya entró
una vez.

## Decisión

La oferta del mismo evento y la misma dirección se borra en el mismo lote que:

- la invitación por uid del dueño;
- la aceptación del invitado, que borra la suya. **Lo imponen las reglas:**
  `acceptsInvite()` rechaza una unión que deje en pie la oferta a la
  dirección del token, así que un cliente antiguo no puede saltárselo;
- la expulsión, con la dirección que guarda la invitación del expulsado, si
  sigue existiendo.

Además, la regla de creación rechaza ofrecer por email un evento a una
dirección cuyo uid, según `userDirectory`, ya es miembro: esa oferta nunca se
gastaría al unirse, y el dueño no ve la dirección de sus miembros para
gastarla al expulsar.

## Consecuencias

- Ninguna oferta anterior a la unión sobrevive a ella; para las posteriores,
  ver T5 más abajo.
- Residual: mientras las ofertas no caduquen, una dirección reutilizada hereda
  las pendientes.
- Residual abierto (T5): un miembro puede borrar su propia entrada de
  `userDirectory` y después su invitación. Sin directorio, el diálogo no lo
  reconoce como miembro y el dueño puede volver a ofrecerle el evento por
  email; sin invitación, la expulsión no sabe a qué dirección se envió. La
  oferta sobrevive y le deja volver. `isToAMember` sólo frena a clientes del
  dueño desfasados o en carrera, no a este camino. Cerrarlo exigiría impedir
  que un invitado borre su invitación mientras sea miembro, lo que cambia el
  borrado del 0013 y queda a decisión del responsable del producto.
- Una invitación sin `inviteeEmail` (el campo es opcional) no deja dirección
  con la que buscar la oferta: la expulsión se limita a sacar al miembro.
- Aceptar cuesta una lectura más (la oferta propia) y la regla una
  comprobación de existencia; ofrecer por email, una lectura del directorio.
