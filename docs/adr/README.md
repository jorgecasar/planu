# Decisiones de arquitectura

Índice de los ADR del proyecto, por número. Ninguno se reescribe una vez
aceptado: si una decisión cambia, se añade un ADR nuevo que la supersede —ver
la columna «Relación» cuando aplica.

| Nº | Título | Qué decide | Relación |
| --- | --- | --- | --- |
| [0001](0001-web-components-con-lit-y-web-awesome.md) | Web components con Lit y Web Awesome | Reescribir la interfaz del prototipo con Lit 3 y Web Awesome sobre Vite, en vez de retomar o modernizar el Next.js/React original | — |
| [0002](0002-eventos-privados-por-usuario.md) | Los eventos son privados por usuario | Cierra la fuga real de lectura pública del prototipo: un único `allow` por operación y `userId` obligatorio fijado al creador | Superado parcialmente por 0006 |
| [0003](0003-generacion-con-ia-hibrida.md) | Generación desde imagen con IA híbrida | Adopta Firebase AI Logic (Prompt API en el dispositivo con fallback a la nube) para extraer un evento de una foto; la nube queda bloqueada por ahora | — |
| [0004](0004-despliegue-continuo.md) | Despliegue continuo desde `main`, con source maps subidos en el build | Despliega en cada push a `main` que pase la verificación, reglas incluidas, con los source maps de Sentry subidos dentro del propio build | Superado en parte por 0005 |
| [0005](0005-sin-entornos-de-preview.md) | Sin entornos de preview: todo va a producción | Elimina los canales de preview por pull request —dominios OAuth dinámicos, datos de producción compartidos— por no haber usuarios reales que aislar | Supersede parcialmente a 0004 |
| [0006](0006-sharing-with-invited-members.md) | Sharing with invited members | Un evento tiene un dueño y una lista de invitados con rol (lector o editor), guardados en el propio documento | Supersede parcialmente a 0002 |
| [0007](0007-client-side-user-directory.md) | The user directory lives in the client | Cada usuario publica su propia entrada de directorio, indexada por el hash de su email, para poder invitar sin Cloud Functions | Complementa a 0006 |
| [0008](0008-identidad-visual.md) | Identidad visual — adopción de la paleta del blueprint | Adopta la paleta y las tipografías del `blueprint.md` heredado (indigo `#3F51B5`, Belleza, Alegreya), traducidas a tokens `--wa-*` | Resuelve una deuda de la fase 1 |
| [0009](0009-analitica-de-activacion.md) | Analítica de activación — Firebase Analytics (GA4) | Elige Firebase Analytics sobre alternativas sin cookies, y por tanto exige aviso de cookies en la landing | — |
| [0010](0010-all-day-flag-y-zona-horaria.md) | Bandera `allDay` explícita, zona horaria pendiente | Añade una bandera `allDay` por evento en vez de inferir el día completo por heurística; deja la zona horaria entre invitados como pregunta abierta | — |
| [0011](0011-verificacion-de-email-obligatoria.md) | Verificación de email obligatoria para usar la aplicación | `isVerified()` pasa a exigirse para crear, leer y editar eventos, no sólo para publicarse en el directorio de compartición; deja sin resolver el bloqueo sobre cuentas reales ya existentes sin verificar | — |
| [0012](0012-invitaciones-pendientes-por-email.md) | Invitaciones pendientes por email sin revelar cuenta | Invitar a un email sin cuenta guarda una oferta pendiente en `eventInvitesByEmail` en vez de perderse, con el mismo mensaje de éxito exista o no la cuenta; no cierra la fuga de red del 0007 y el reclamo automático es hoy un no-op documentado | Complementa a 0007 |
| [0013](0013-borrado-de-invitaciones-con-la-cuenta.md) | Las invitaciones se borran con la cuenta | Quien invita (verificado) y quien es invitado borran una invitación en cualquier estado, y el borrado de cuenta elimina las recibidas y las enviadas | Supersede parcialmente la regla de borrado de `spec-invitation-activity.md` |
