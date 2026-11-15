# Spec · Avisar por correo a quien se invita (GH-282)

> Es una especificación, no cambia código ni configuración. No sustituye a
> [`SPEC.md`](../SPEC.md). Escrita por la sesión de coordinación mientras la
> sesión de planu no respondía: **sin verificar contra el código**, solo contra
> los ADR 0007, 0011, 0012 y 0014. Lo que no está verificado va marcado como
> «verificar».

## Objetivo

Hoy, al invitar a alguien por email, **no se envía nada** a esa persona
(ADR 0012): la invitación queda en `eventInvites` o, si no tiene cuenta, en
`eventInvitesByEmail`, y solo la ve cuando entra con ese email. Quien invita
tiene que avisarla por su cuenta. Y si la persona se registra después, el alta
no reclama la oferta pendiente (GH-280).

Que quien invita pueda avisar a la persona invitada con un enlace claro, y
que quien se registra desde ese aviso encuentre su invitación.

## Restricción de partida

El proyecto no tiene servidor: sin Cloud Functions, sin plan Blaze, por coste
recurrente (ADR 0007, repetido en el 0012). **Enviar un correo desde planu a un
tercero necesita código que corra fuera del navegador**, lo que casi siempre
exige Blaze. Esta decisión no se puede tomar sin reabrir esa restricción, o
sin elegir una vía que no la reabra.

## Opciones

| | Qué | A favor | En contra |
| --- | --- | --- | --- |
| A | **Sin servidor: enlace + «Enviar por correo» (`mailto:`) + copiar + compartir del sistema** | Cero coste y cero dependencias; el correo sale de la cuenta de quien invita, no de planu; sin riesgo de spam atribuible a planu | Depende de que haya un cliente de correo configurado; no hay confirmación de envío |
| B | Extensión «Trigger Email» de Firebase (verificar) con un proveedor SMTP | Poco código propio | Exige Blaze; hay que tener un proveedor, dominio remitente y cuidar el abuso |
| C | Cloud Function + proveedor (Resend, SendGrid u otro) | Control total del contenido y los límites | Exige Blaze, secretos, despliegue y mantenimiento; el mayor coste de operación |
| D | Servicio de correo desde el cliente (p. ej. EmailJS) | Sin servidor propio | Las claves viajan en el cliente: cualquiera puede mandar correos con la identidad de planu. Descartada |
| E | Correo de enlace de acceso de Firebase Auth (`sendSignInLinkToEmail`) | Sin Blaze; lo envía Firebase | Es un correo de inicio de sesión, no una invitación; cualquiera puede dispararlo contra un tercero; contenido casi fijo (verificar) |

## Recomendación

**Fase 1: A, sin servidor.** Al invitar, el diálogo ofrece, junto a la
confirmación, tres acciones: «Enviar por correo» (abre el correo de quien
invita con asunto, texto y enlace ya escritos), «Copiar enlace» y «Compartir»
(Web Share cuando el navegador lo permita). El enlace lleva a la landing o al
alta con la invitación como destino. Es lo único que se puede ofrecer hoy sin
decidir nada sobre Blaze, y cierra la queja de «invito y no pasa nada».

**Fase 2, solo si el responsable lo decide: B o C**, con el correo enviado por
planu. Es una decisión de coste y de operación, no técnica, y debe tomarse con
los números delante (ver «Costes y operación»).

Ninguna de las fases elimina la necesidad de **GH-280**: que el alta reclame
las ofertas por email pendientes de quien se registra. Sin eso, el enlace de
la fase 1 lleva a una cuenta sin nada que ver.

## Lo que el enlace puede y no puede decir

El enlace es público: puede acabar en un chat o un correo ajeno. Por el
ADR 0012 (no revelar si una cuenta existe) y el 0014 (las ofertas no
caducan), el enlace:

- **No lleva el email de la persona invitada ni su identificador.** Lleva solo
  el identificador del evento o un token aleatorio, y no confirma nada por
  sí mismo.
- **No da acceso.** La invitación solo se reclama entrando con el email al que
  se ofreció y verificado (ADR 0011). Quien abre el enlace con otro correo ve
  un mensaje genérico y no se le revela nada del evento.
- Verificar: que un enlace con identificador de evento no permita comprobar
  existencia de eventos (oráculo del ADR 0012).

## Si se enviara desde planu (fase 2)

### Abuso
Un correo a un tercero lo dispara quien invita. Sin límites, planu sería un
emisor de spam.
- Solo quien posee el evento, con email verificado, puede disparar un correo
  (ya lo exigen las reglas de `eventInvitesByEmail`).
- Límite por persona y día, y por destinatario y semana, y botón de baja que
  añade al destinatario a una lista de bloqueo.
- Sin texto libre en el correo, o con texto libre acotado y moderado: es un
  vector de suplantación.

### RGPD
- El destinatario no ha dado su consentimiento a planu; la base legal (interés
  legítimo de quien invita, frente a consentimiento) y la información que
  debe llevar el correo (quién lo envía y cómo darse de baja) necesitan
  revisión legal.
- Se manda un dato personal (el email) a un tercero, el proveedor de correo:
  contrato de encargo y mención en la política de privacidad.

### Entregabilidad
Con SPF y DKIM en un dominio propio. Verificar si planu tiene dominio propio o
solo el de Firebase Hosting; sin dominio propio el correo caerá en spam.

### Costes y operación (a estimar antes de decidir)
Plan Blaze con tarjeta; el proveedor de correo y su nivel gratuito; volumen
esperado de invitaciones al mes. Verificar con las cifras reales de uso, que
esta spec no tiene.

## Cambios previstos (fase 1)

- `share-dialog.ts`: tras invitar, acciones «Enviar por correo», «Copiar
  enlace» y «Compartir». Textos nuevos en español e inglés (`msg()`).
- Una función pura que construye el `mailto:` y el texto, con su test.
- La landing o el alta aceptan el parámetro de invitación sin revelar nada.
- Reglas de Firestore: **sin cambios** en la fase 1.
- `TOPE_ACOPLADOS`: sin subir; la función de texto vive en `domain` o
  `application`.

## Rodajas (cada una ≤ 200 líneas)

1. Función pura del texto y del `mailto:`, con tests.
2. Acciones en el diálogo de compartir, con test del diálogo y e2e.
3. Enlace de invitación: destino en la landing o el alta, sin filtrar datos.
4. GH-280 aparte: el alta reclama las ofertas por email pendientes.

## Preguntas abiertas para el responsable

1. ¿Se empieza por la fase 1 (sin servidor) y se deja la fase 2 para más
   adelante? Recomendado: sí.
2. ¿Se acepta reabrir la restricción de «sin Blaze» para la fase 2? Si sí, con
   qué presupuesto mensual máximo.
3. ¿Tiene planu un dominio propio para el remitente?
4. ¿Se revisa con asesoría legal el correo desde planu a terceros antes de la
   fase 2?

## Decisiones del responsable (2026-11-15)

- **Fase 1, sin servidor: sí.** Enlace, «Enviar por correo» (`mailto:`), copiar y
  compartir, sin coste ni plan Blaze. Va junto con GH-280 (el alta reclama las
  ofertas pendientes).
- **Fase 2 (correo enviado por planu): aparcada.** Se mantiene la restricción de
  «sin plan Blaze» del ADR 0007. Se revisará cuando haya usuarios reales y una
  razón de coste que lo justifique.
- **Dominio:** solo el de Firebase Hosting; no hay dominio propio. Mientras no
  lo haya, un correo enviado por planu no tendría SPF ni DKIM propios y caería
  en spam: otra razón para no abrir la fase 2 ahora.

Siguiente paso: las rodajas 1 a 4 de la sección anterior, empezando por la
función pura del texto y del `mailto:`.
