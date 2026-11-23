# Runbook de incidentes y brechas de datos personales

> **BORRADOR técnico. No es asesoramiento legal.** No afirma que planu cumpla
> ningún reglamento. Pendiente de la persona responsable (HU-438) y de revisión
> por un asesor jurídico. Todo lo marcado `TODO(owner)` sólo lo puede rellenar
> el responsable o el asesor. Lo que no se ha podido comprobar en el repositorio
> figura como pregunta abierta.

## 1. Alcance

Un incidente es cualquier suceso que comprometa la seguridad o el servicio. Una
brecha de datos personales es el subconjunto que provoca destrucción, pérdida,
alteración, comunicación o acceso no autorizados a datos personales (RGPD, art.
4.12). Los datos que guarda planu: cuenta de Firebase Auth (correo, uid),
perfiles y directorio de usuarios, eventos, invitaciones (también las dirigidas
a correos sin cuenta), imágenes en Storage. Los eventos son privados por defecto
([ADR 0002](adr/0002-eventos-privados-por-usuario.md),
[ADR 0006](adr/0006-sharing-with-invited-members.md)).

## 2. Roles

| Rol | Persona | Contacto |
| --- | --- | --- |
| Responsable del tratamiento y de la decisión de notificar | TODO(owner) | TODO(owner) |
| Persona de guardia técnica | TODO(owner) | TODO(owner) |
| Asesor jurídico | TODO(owner) | TODO(owner) |
| Delegado de protección de datos, si procede | TODO(owner) | TODO(owner) |

El canal público de contacto es el correo que ya publican la landing y los
textos legales (`apps/web/src/ui/landing/legal.ts`). Que sea también el canal de avisos de seguridad es
una decisión pendiente: TODO(owner).

## 3. Detección

- **Sentry**: errores del cliente (`apps/web/src/infrastructure/sentry/`). Sólo
  arranca tras el consentimiento y no envía datos personales por defecto, así
  que **la ausencia de alertas no demuestra la ausencia de incidente**. En el
  repositorio no hay reglas de alerta definidas: pregunta abierta, comprobar en
  el proyecto de Sentry.
- **Consola de Firebase**: uso anómalo de Auth, picos de lecturas en Firestore,
  errores y reintentos de la función `onAccountDeleted` (`apps/functions`),
  actividad de Storage. La retención de Cloud Logging no está documentada:
  TODO(owner) comprobarla.
- **Terceros**: avisos de Google, GitHub o Sentry, informes de usuarios o de
  investigadores de seguridad al canal de contacto.
- Cualquier persona que sospeche algo lo comunica a la guardia técnica. Se
  anota la hora en que se detectó (ver §9).

## 4. El reloj de 72 horas

- **Art. 33 RGPD**: el responsable notifica a la autoridad de control sin
  dilación indebida y, si es posible, **a más tardar 72 horas después de tener
  constancia** de la brecha, salvo que sea improbable que entrañe riesgo para
  las personas. Pasadas las 72 horas, la notificación explica el retraso.
  Puede darse por fases si no hay toda la información.
- **Art. 34**: si la brecha entraña **alto riesgo** para derechos y libertades,
  se informa **a las personas afectadas sin dilación indebida**, en lenguaje
  claro.
- Art. 33.5: toda brecha se documenta, se notifique o no (§9).
- El reloj arranca cuando se tiene una constancia razonable, no cuando termina
  la investigación. Anota la hora exacta de esa constancia.
- Autoridad de control competente y su canal de notificación: TODO(owner)
  (depende del establecimiento del responsable; lo confirma el asesor).

## 5. Lista de decisión

Responder por escrito, con hora, y dejarlo en el registro del incidente:

1. ¿Hay datos personales implicados? ¿Cuáles: correos, uid, nombres, eventos
   (título, ubicación, fechas), invitaciones, imágenes?
2. ¿Cuántas cuentas y cuántas personas sin cuenta (ofertas por correo) están
   afectadas? Si no se sabe, anotarlo como desconocido, no como cero.
3. ¿Qué tipo de brecha: confidencialidad (acceso o lectura), integridad
   (modificación) o disponibilidad (pérdida o borrado)?
4. ¿Sigue el acceso abierto? ¿Desde cuándo?
5. ¿Los datos estaban expuestos en claro? Recordatorio: la URL de
   `getDownloadURL()` de una imagen lleva un token portador y no depende de las
   reglas (ver AGENTS.md, «Estado de seguridad»).
6. ¿Riesgo para las personas (suplantación, exposición de agenda o ubicación,
   daño reputacional)? ¿Alto riesgo? Decide el responsable con el asesor:
   TODO(owner).
7. Resultado: sin notificación (con justificación escrita) / notificar a la
   autoridad / notificar además a las personas afectadas.
8. ¿Hay encargados implicados (Google, Sentry)? Avisar a su contacto de
   seguridad.

## 6. Contención específica de este stack

Primero parar la hemorragia, sin destruir evidencia (§7). Todo paso que cambie
producción necesita **aprobación humana explícita**; un agente no despliega.

1. **Credenciales**: rotar las claves de API del proyecto y las cuentas de
   servicio en la consola de Google Cloud, y los secretos del CI
   (`.github/workflows/ci.yml` los usa; no se escriben aquí). Rotar también el
   DSN de Sentry si se sospecha que se ha filtrado.
2. **Sesiones**: revocar los tokens de refresco de las cuentas afectadas con
   Admin SDK (`revokeRefreshTokens`) o deshabilitar la cuenta desde la consola
   de Auth. Los ID tokens ya emitidos siguen valiendo hasta caducar (hasta una
   hora).
3. **Reglas**: si el acceso viene de `firestore.rules` o `storage.rules`,
   preparar el cambio restrictivo en una rama, con su prueba en
   `apps/web/rules/`, y desplegar **sólo con la aprobación de una persona**.
   Recordar el OR entre reglas: un único `allow` por operación.
4. **Función**: si `onAccountDeleted` borra de más o se comporta mal, deshabilitar
   o eliminar la función desde la consola de Firebase para detener el barrido.
   Tiene `retry: true`, así que un fallo se repite hasta resolverse.
5. **Imágenes expuestas**: borrar el objeto de Storage o regenerar su token de
   descarga desde la consola, lo que invalida la URL antigua.
6. **Despliegue sospechoso**: volver a la versión anterior de Hosting desde la
   consola (historial de versiones). El despliegue normal es continuo desde
   `main` ([ADR 0004](adr/0004-despliegue-continuo.md)); considerar parar la
   cadena hasta cerrar el incidente.
7. **Cuentas de desarrollador**: revisar accesos al proyecto en IAM y a GitHub.

Preguntas abiertas: ¿hay copias de seguridad o exportaciones programadas de
Firestore? ¿App Check está activo? (la auditoría de #427 no encontró App Check).

## 7. Evidencia a conservar

- Exportar registros de Cloud Logging, de Auth y de Sentry del periodo antes de
  que caduquen. Plazo de conservación del expediente: TODO(owner).
- Capturas de la consola con hora, versión de reglas desplegada, SHA del
  commit en producción y diff de lo que se cambió.
- Lista de cuentas y recursos afectados (identificadores, no contenido).
- Quién hizo qué y cuándo, incluidas las comunicaciones con terceros.
- No copiar datos personales a chats ni a tickets públicos.

## 8. Comunicaciones

- **A la autoridad**: contenido mínimo del art. 33.3 (naturaleza de la brecha,
  categorías y número aproximado de personas y registros, contacto, consecuencias
  probables, medidas adoptadas). Redacta el responsable con el asesor.
- **A las personas** (art. 34): qué ha pasado, qué datos, qué hacer y a quién
  escribir, en el idioma de la aplicación. Medio de aviso (correo de la cuenta,
  aviso en la aplicación): TODO(owner).
- Plantillas de ambos textos: TODO(owner) con el asesor.

## 9. Registro cronológico (plantilla)

Copiar por incidente a un expediente privado, no a este repositorio.

| Hora (UTC) | Suceso o decisión | Quién | Evidencia |
| --- | --- | --- | --- |
| | Detección | | |
| | Constancia razonable de brecha (arranca el reloj de 72 h) | | |
| | Contención | | |
| | Evaluación de riesgo (§5) | | |
| | Notificación a la autoridad, o justificación de no hacerlo | | |
| | Aviso a las personas, o justificación de no hacerlo | | |
| | Cierre | | |

## 10. Revisión posterior

En la semana siguiente al cierre, sin buscar culpables:

1. Causa raíz y qué la dejó pasar (regla, prueba, alerta o proceso ausente).
2. ¿Se cumplieron las 72 horas? Si no, por qué.
3. Qué funcionó y qué estorbó en este runbook; corregirlo.
4. Acciones con responsable y fecha; las técnicas, como tarjetas del plan.
5. Si cambia una decisión de seguridad, añadir un ADR nuevo en lugar de
   reescribir uno aceptado.
6. Actualizar los textos legales si los hechos que describen han cambiado.
