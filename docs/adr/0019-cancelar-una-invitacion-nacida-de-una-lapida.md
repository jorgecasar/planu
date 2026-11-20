# 0019 · Cancelar una invitación nacida de una lápida: ¿se restaura o se borra?

- **Fecha:** 2026-11-20 · **Estado:** aceptada el 2026-11-20, opción A; decide el responsable del producto
- **Complementa a:** [0015](0015-lapida-al-salir-de-un-evento.md), que no se reescribe · **Issue:** GH-192

## Decisión

El 2026-11-20 el responsable del producto elige la **opción A**: se aceptan
(c) y (c′) como residuales de gravedad baja, sin cambiar `firestore.rules`, y se
vigilan con la acción de retirar ofertas por email que ya existe en el diálogo
de compartir (#335). Se revisan antes del lanzamiento, que es cuando habrá
usuarios reales.

## Contexto

El 0015 dejó dos residuales abiertos, ambos dependientes de una acción del
dueño y con una oferta por email antigua a una dirección distinta de la escrita
en el diálogo:

- **(c′)** El dueño vuelve a invitar por uid a alguien que expulsó y luego
  cancela esa invitación. Cancelar borra el documento y con él la lápida, así
  que una oferta antigua por email deja volver a esa persona.
- **(c)** Alguien al que se ha vuelto a invitar por uid borra esa invitación
  pendiente y reclama una oferta por email más antigua. Entra con el rol de esa
  oferta.

Ya está hecho: #322 caracteriza los dos escenarios con tests de reglas y #335
deja listar y retirar ofertas por email desde el diálogo. Las reglas ya
permiten al dueño verificado borrar una lápida (`firestore.rules`, `allow
delete` de `eventInvites`); lo cubren los tests de esta rama.

## Opciones

- **A. Aceptar el residual.** No cambia reglas. Con la oferta visible y
  retirable en el diálogo, el dueño puede cerrar (c′) a mano. (c) no se puede
  cerrar con reglas sin memoria: cuando el invitado borra su pendiente el
  documento desaparece y las reglas no ven lo borrado, e impedirle borrarla
  choca con el [0013](0013-borrado-de-invitaciones-con-la-cuenta.md) (RGPD) y
  con el borrado de cuenta.
- **B. Restaurar la lápida al cancelar.** Cancelar una invitación nacida de una
  lápida la devuelve a `removed` en vez de borrarla. Cierra (c′), pero exige una
  regla nueva (`ownerWithdraws`) y su batería de tests, en la misma PR de reglas
  que GH-259, con revisión humana. Con esa regla, además, una primera invitación
  cancelada también dejaría una lápida.

## Consecuencias

- **A:** sin código nuevo ni riesgo en las reglas. Se acepta que (c) y (c′)
  existan mientras no haya usuarios reales; se revisan antes del lanzamiento.
- **B:** cierra (c′) pero toca `firestore.rules`, lo que pide luces encendidas
  (revisión humana y `security-auditor`) y no cierra (c).
