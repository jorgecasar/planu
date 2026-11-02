# Spec: registro de invitaciones

Amplía [`spec-fase-2.md`](spec-fase-2.md), que en F2 dejó las invitaciones como
un aviso efímero: aparecen, se aceptan o se rechazan, y desaparecen sin dejar
rastro. Este documento las convierte en un **registro consultable**.

## Objetivo

Hoy una invitación es un callout encima del listado. Eso falla en tres cosas:

1. **No se puede decidir con criterio.** La tarjeta dice quién invita y a qué
   título, y nada más.
2. **No se puede consultar después.** Aceptada o rechazada, desaparece. Quien
   rechaza por error no tiene forma de recuperarla, y quien acepta no puede
   comprobar cuándo ni quién le invitó.
3. **No escala.** Veinte invitaciones son veinte avisos apilados sobre el
   listado, y no hay ni tope ni forma de gestionarlas en bloque.

**Éxito** = alguien con quince invitaciones puede verlas en un sitio pensado
para eso, decidir una a una con la información suficiente, y meses después
consultar quién le invitó a qué y qué respondió.

## Alcance

### Dentro

- **Sección de avisos** en el listado: sólo las pendientes, con acción directa.
- **Página de invitaciones** (`/invitations`) con dos grupos: pendientes y
  decididas.
- Cada entrada muestra el **título del evento**, **quién invita**, el **rol
  ofrecido**, la **fecha de la invitación** y, si ya se decidió, la **fecha de
  la decisión**.
- Cambiar una decisión ya tomada.

### Fuera, y por qué

- **Notificaciones genéricas.** Sólo existen invitaciones; un modelo para avisos
  que aún no existen sería diseñar a ciegas. Si algún día hay recordatorios o
  cambios de evento, se replantea entonces.
- **Detalle del evento antes de aceptar.** Decidido: la invitación copia el
  título y nada más. Ver fechas o ubicación exigiría o duplicar datos que
  quedarían obsoletos, o abrir `allow read` con un `exists()` que se evaluaría
  en **toda** lectura de eventos —una lectura facturable extra por documento del
  listado— para servir un caso excepcional.
- **Tope de invitaciones por persona.** Las reglas no pueden contar documentos.
  Sin backend no hay límite duro; lo que esta spec aporta es que veinte
  invitaciones dejen de ser veinte avisos apilados.
- **Avisos por email o push.** Exigen backend.

## Decisiones tomadas

| Decisión | Elección |
| --- | --- |
| Alcance | Registro de invitaciones, no notificaciones genéricas |
| Qué se copia en la invitación | Sólo el título del evento y quién invita |
| Qué se guarda | Fecha de la invitación y fecha de la decisión |
| Qué se muestra | Pendientes, aceptadas y rechazadas |
| Cambiar de opinión | Sí, sobre una decisión ya tomada |

### La decisión que falta, y por qué importa

**¿Una invitación aceptada sirve para volver a entrar?**

Hoy la invitación se **borra** al aceptarla, y por eso expulsar a alguien es
definitivo. Al conservarla como registro, la regla de aceptación tiene que
distinguir una invitación viva de una ya consumida, o **expulsar deja de
significar nada**: bastaría con volver a pulsar «aceptar».

Propuesta: la regla exige `status == 'pending'`. Aceptar la pasa a `accepted` y
deja de servir. Para readmitir a alguien, el dueño la vuelve a poner en
`pending`, lo cual es un acto explícito suyo y queda registrado con fecha nueva.

Consecuencia: «cambiar la decisión» sólo funciona en un sentido sin intervención
del dueño —de `declined` a `pending`, que es reconsiderar algo que nadie ha
retirado—. Volver a entrar tras salir o tras ser expulsado requiere que el dueño
invite de nuevo. Es lo correcto: salir es una decisión tuya, readmitir es suya.

## Modelo de datos

```
eventInvites/{eventId}_{inviteeUid}
  eventId: string
  eventTitle: string          # copia; el invitado no puede leer el evento
  inviteeUid: string
  inviteeEmail: string
  invitedBy: string
  invitedByName: string
  role: "viewer" | "editor"
  status: "pending" | "accepted" | "declined"     # nuevo
  createdAt: timestamp                            # nuevo
  decidedAt: timestamp | null                     # nuevo
```

El documento deja de borrarse. Un `delete` sigue existiendo sólo para el dueño,
como revocación de algo aún pendiente. Supersedido por el [ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md): cualquiera de las dos partes borra en cualquier estado.

## Reglas

- `create`: sólo el dueño del evento, con `status == 'pending'`, `createdAt`
  del servidor y `decidedAt == null`.
- `update`: dos vías, en un único `allow`:
  - **El invitado decide**: sólo puede pasar de `pending` a `accepted` o
    `declined`, o de `declined` a `pending`, tocando únicamente `status` y
    `decidedAt`. Nunca el rol, ni el evento, ni quién invita.
  - **El dueño readmite**: de `accepted` o `declined` a `pending`, con
    `decidedAt` a null.
- `read`: sin cambios; sólo sus dos partes.
- `delete`: sólo el dueño, y sólo mientras esté `pending`. Borrar una decidida
  destruiría el registro. Supersedido por el [ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md): cualquiera de las dos partes borra en cualquier estado.
- La rama `acceptsInvite()` de `events` pasa a exigir **`status == 'pending'`**.

## Interfaz

**Sección de avisos** (listado): sólo pendientes, con «Aceptar» y «Rechazar».
Por encima de tres, se muestran las tres primeras y un enlace a la página.

**Página `/invitations`**: pendientes arriba, decididas debajo, ordenadas por
fecha descendente. Cada fila: título, quién invita, rol, fecha de invitación y,
si la hay, fecha y sentido de la decisión. Sobre una decidida, la acción es
«Cambiar a pendiente» y sólo aparece en las rechazadas.

## Estrategia de tests

- **Reglas**: cada transición de estado permitida y, sobre todo, las prohibidas
  — aceptar una `accepted`, cambiar el rol al decidir, que el invitado se
  readmita solo tras ser expulsado, borrar una decidida. Supersedido por el [ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md): cualquiera de las dos partes borra en cualquier estado.
- **Unitarios**: agrupación y orden de la lista.
- **E2e**: con dos sesiones, el ciclo completo — invitar, rechazar, comprobar
  que queda registrado, reconsiderar y aceptar.
- **Axe** en la página y en la sección.

## Criterios de éxito

1. Una invitación rechazada sigue consultable, con sus dos fechas.
2. Reconsiderar una rechazada y aceptarla mete a la persona en el evento.
3. **Expulsar a alguien no se puede deshacer desde su lado**: su invitación
   queda `accepted` y no sirve para reentrar.
4. Con quince invitaciones, el listado no se llena de avisos.
5. Las fechas las pone el servidor, no el cliente.
6. Cero violaciones de axe.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Conservar el registro reabre la reentrada tras ser expulsado | `status == 'pending'` en la regla de aceptación, con test propio |
| El registro crece sin límite y son datos personales | El borrado de cuenta elimina las recibidas y las enviadas ([ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md)); falta la política de privacidad (F13) |
| El título copiado envejece si el evento se renombra | Aceptado: es un registro de lo que se ofreció, no un espejo del evento |
| Una página nueva toca el enrutado, que T25 está moviendo a `/app` | Ir después de T25, o dar la ruta ya bajo `/app` |

## Preguntas abiertas

1. **Retención.** ¿Se conservan las decididas para siempre, o caducan? Sin
   backend no hay quien las borre solo. Respondida en parte por el
   [ADR 0013](adr/0013-borrado-de-invitaciones-con-la-cuenta.md): duran hasta
   que una de las dos partes la borra o borra su cuenta; no caducan.
2. **Rama.** Esto amplía `eventInvites`, que vive en `feat/event-sharing` y aún
   no está fusionada. O va en esa misma rama, o encadena una rama sobre ella.
