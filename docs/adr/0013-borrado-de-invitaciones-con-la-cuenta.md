# 0013 · Las invitaciones se borran con la cuenta

- **Fecha:** 2026-11-02 · **Estado:** aceptado
- **Supersede parcialmente:** el borrado de [`spec-invitation-activity.md`](../spec-invitation-activity.md) («una invitación decidida es historia»)

## Contexto

Una invitación guarda los uids de las dos partes y sobrevive a la decisión.
Sólo quien invita, verificado y si seguía pendiente, podía borrarla: borrar
la cuenta (RGPD, art. 17) dejaba atrás recibidas y decididas.

## Decisión

Cualquiera de las dos partes la borra en cualquier estado. Quien invita debe
estar verificado (sólo así pudo invitar); quien es invitado no, porque una
cuenta sin verificar puede recibirlas. `deleteAccount()` borra las recibidas
siempre y las enviadas si la cuenta está verificada, antes que la de Auth.

## Consecuencias

- El registro deja de ser permanente cuando una parte lo borra. Borrar no
  reabre la puerta: aceptar exige una invitación pendiente que exista.
- El invitado puede borrar una pendiente sin rechazarla: el dueño deja de
  ver la oferta y puede volver a invitar, igual que tras un rechazo.
- Con la verificación revocada quedan las enviadas, como los eventos (T67).
