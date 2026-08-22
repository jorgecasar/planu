# Spec: planu — fase 2

- **Estado:** entregada, con tres excepciones explícitas
- **Fecha de esta evaluación:** 2026-08-22

Las dieciséis funcionalidades (F1–F16, tareas T11–T34) están entregadas y
verificadas según la evidencia de [`tasks/todo.md`](../tasks/todo.md), con tres
excepciones registradas ahí y en [`tasks/plan.md`](../tasks/plan.md):

1. **F11, criterio de LCP.** El Checkpoint F no se marca entero: mediana de 5
   pasadas de Lighthouse contra producción da **1,9 s**, por encima del 1,5 s
   exigido (evaluado el 22/08/2026). El resto del checkpoint —0 KB de
   JavaScript, navegación sin JS, textos desde el mismo XLIFF que la
   aplicación— sí está cerrado.
2. **Cierre de la arquitectura hexagonal (T37, T38, T39).** Fuera del alcance
   de este documento —tiene spec propia en
   [`docs/spec-arquitectura-hexagonal.md`](spec-arquitectura-hexagonal.md)—
   pero mencionada aquí porque T34 la evalúa: T35 (capas y frontera) y T36
   (puerto de sesión) están entregados; T37 y T38 sólo migraron
   `event-editor.ts`, no `events-view.ts`, `event-card.ts` ni `lib/types.ts`;
   T39 no se ha empezado. Ver Checkpoint H en `tasks/plan.md`.
3. **Registro de invitaciones (fase 13, T40–T41).** Especificado en
   [`docs/spec-invitation-activity.md`](spec-invitation-activity.md), sin
   empezar. Una invitación sigue siendo efímera: se acepta o se rechaza y el
   documento de `eventInvites` se borra, sin dejar registro consultable.

El Checkpoint G de `tasks/plan.md` —los dieciséis criterios de éxito del
spec, con la suite completa en verde— no se marca entero mientras las tres
excepciones de arriba sigan abiertas. Todo lo demás de este documento está
entregado.

---

Segunda tanda de funcionalidad sobre la base ya entregada (T0–T10 de
[`tasks/todo.md`](../tasks/todo.md)). **No sustituye a [`SPEC.md`](../SPEC.md):**
lo amplía. Todo lo que aquel documento fija —stack, decoradores legacy, base
`planu`, i18n con `msg()`, cero violaciones de axe— sigue vigente y no se repite
aquí salvo cuando esta fase lo cambia.

## Objetivo

La aplicación de la fase 1 es un cuaderno de eventos de un solo usuario: creas,
buscas y borras lo tuyo, y ahí acaba. Esta fase la convierte en algo que se usa
**con otras personas y junto al resto de tu vida**:

- **Con otras personas**: un evento puede compartirse con invitados que tienen
  cuenta, como lectores o como editores.
- **Junto al resto de tu vida**: los eventos salen hacia el calendario que ya
  usas, en vez de pedir que vivas dentro de planu para no olvidarte de nada.
- **Con más forma**: vista de calendario y etiquetas, porque una rejilla plana
  de tarjetas deja de servir pasados veinte eventos.
- **Con menos teclear**: la IA ya lee carteles; ahora también lee el texto que
  pegas.

Y la convierte en **algo que se puede enseñar**. Hoy planu no tiene puerta de
entrada: quien llega a la raíz se topa con un formulario de acceso a un producto
del que no se le ha contado nada, sin identidad visual propia, sin política de
privacidad y sin forma de borrar su cuenta. Eso no es una aplicación a la que se
pueda mandar a nadie. Esta fase le pone cara pública, marca, legales y una
primera sesión que enseña a usarla.

**Éxito** = dos usuarios distintos ven el mismo evento con permisos distintos y
verificados por reglas, ese evento acaba en el calendario del sistema operativo
de ambos, quien tiene sesenta eventos los encuentra por mes y por etiqueta sin
buscar a ciegas, y a un desconocido se le puede pasar el enlace sin acompañarlo
de una explicación.

### Lo que esta fase cambia del modelo anterior

El [ADR 0002](adr/0002-eventos-privados-por-usuario.md) declaró los eventos
privados por usuario. Esta fase **lo supersede parcialmente**: siguen siendo
privados por defecto, pero dejan de ser exclusivos de una persona. Hay que
escribir el ADR que registre el cambio; el 0002 no se reescribe.

## Alcance

### Dentro

Dieciséis funcionalidades, agrupadas en cinco territorios:

| # | Funcionalidad | Territorio |
| --- | --- | --- |
| F1 | Directorio mínimo de usuarios | Compartir |
| F2 | Compartir un evento con invitados (lector / editor) | Compartir |
| F3 | Bandeja «Compartidos conmigo» y rol visible | Compartir |
| F4 | Exportar a calendario (`.ics` y Google Calendar) | Recordatorios |
| F5 | Vista de calendario y vista de agenda | Vistas |
| F6 | Etiquetas y filtro por etiqueta | Vistas |
| F7 | Orden y agrupación por próximos / pasados | Vistas |
| F8 | Crear evento desde texto pegado | IA |
| F9 | Sugerencia de etiquetas al guardar | IA |
| F10 | Separación landing / aplicación | Producto |
| F11 | Landing pública, con SEO y compartible | Producto |
| F12 | Identidad visual propia | Producto |
| F13 | Privacidad, términos y cookies | Producto |
| F14 | Borrado de cuenta y de todos sus datos | Producto |
| F15 | Onboarding y primera sesión | Producto |
| F16 | Analítica de activación, con consentimiento | Producto |

El territorio de producto es **independiente** de los otros cuatro: no comparte
código con ellos y puede entregarse antes, después o en paralelo. La única
excepción es F14, que necesita saber qué hay que borrar y por tanto depende de
que F2 y F6 hayan fijado el modelo de datos definitivo.

### Fuera, y por qué

- **Eventos recurrentes.** RRULE, excepciones y «editar sólo esta ocurrencia»
  son un proyecto en sí mismo y se comerían la tanda. Spec propio más adelante.
- **Notificaciones push y recordatorios por email.** Un recordatorio fiable
  necesita un proceso que corra sin la app abierta, es decir, Cloud Functions
  programadas y plan Blaze. Coste recurrente: cae en «preguntar primero». F4
  cubre la necesidad delegándola al calendario del usuario, que ya sabe avisar.
- **Enlace público de sólo lectura sin cuenta.** Descartado a favor de invitados
  identificados: el requisito era colaborar, no publicar.
- **Comentarios, confirmación de asistencia, adjuntos.** No pedidos.
- **Precios y cobro.** El claim `premium` de
  [`ai-policy.ts`](../apps/web/src/domain/ai-policy.ts) seguirá asignándose a
  mano para contener el coste de la IA. La landing **no menciona planes ni
  precios**: prometer un plan de pago que no existe obliga a mantener esa
  promesa. Cobrar de verdad exige Stripe, webhooks y Blaze; es su propia tanda.

## Decisiones ya tomadas

| Decisión | Elección | Consecuencia |
| --- | --- | --- |
| Modelo de compartición | Invitados con cuenta y rol | Reglas y modelo de datos nuevos; ADR obligatorio |
| Recordatorios | Export a calendario, sin backend | Cero coste, cero infraestructura |
| Recurrencia | Fuera de alcance | El modelo de datos no gana campos de repetición |
| Landing | Página estática aparte, no una ruta de la SPA | La app se muda a `/app`; los rewrites de Hosting cambian |
| Construcción de la landing | Prerender en build con `@lit-labs/ssr`, sin hidratar | Se escribe con `lit-html` y `msg()`, se sirve como HTML plano. Dependencia de desarrollo nueva, ya aprobada |
| JavaScript en la landing | **0 KB por defecto**, tope de 10 KB comprimido | Comprobado en el build, que falla si se pasa |
| Monetización | Ninguna por ahora | Sin página de precios y sin infraestructura de cobro |
| Alcance de producto | Marca, legales, onboarding y analítica | Cuatro frentes que hoy no existen en el repo |

### Orden de entrega sugerido

No es el plan —eso es cosa de `/plan`—, pero hay tres restricciones de orden que
conviene fijar aquí porque salen del propio diseño:

1. **F10 va primero y sola.** Toca enrutado, guarda de sesión y despliegue a la
   vez; mezclarla con otra cosa hace imposible saber qué rompió qué.
2. **F12 antes que F11.** Escribir la landing y después redecorarla es hacerla
   dos veces.
3. **La decisión de F14 sobre «salir de un evento» se toma antes de escribir
   las reglas de F2.** Cambiar reglas ya desplegadas es mucho más caro.

Fuera de eso, el territorio de producto y los otros cuatro avanzan en paralelo.

### Desviación razonada sobre el boceto de compartición

El boceto que se aprobó dibujaba una subcolección `events/{id}/members/{uid}` y
reglas con `get()`. Se propone en su lugar guardar la membresía **dentro del
propio documento del evento**, en dos campos:

```
events/{eventId}
  userId: string                       # dueño, inmutable
  memberIds: string[]                  # incluye al dueño
  roles: { [uid: string]: "viewer" | "editor" }   # sólo invitados
```

Tres razones:

1. `memberIds` como array en el documento es **obligatorio de todas formas**:
   sin él no existe la consulta `array-contains` que alimenta F3. Con la
   subcolección habría que denormalizar igual, y entonces la subcolección sólo
   añade un segundo sitio donde la verdad puede desincronizarse.
2. Cada `get()` en una regla es **una lectura facturable por evaluación**. Con
   los roles en el documento, la regla no lee nada extra.
3. El riesgo evidente —que un editor se ascienda a sí mismo— se cierra con una
   condición, no con una subcolección: en un `update` de un editor, `memberIds`,
   `roles` y `userId` deben quedar idénticos. Sólo el dueño toca la membresía.

Si prefieres la subcolección de todas formas, dilo antes de la fase de plan: es
un cambio barato ahora y caro después.

## Las dieciséis funcionalidades

### F1 · Directorio mínimo de usuarios

**Por qué existe:** para invitar a alguien por su email hace falta traducir ese
email a un `uid`, y Firebase Auth no expone directorio alguno al cliente. Sin
esta pieza, F2 no puede existir sin Cloud Functions.

**Qué es:** una colección `userDirectory/{emailHash}` donde cada usuario publica
su propio `uid` y su nombre visible al iniciar sesión. `emailHash` es el
SHA-256 hexadecimal en minúsculas del email normalizado (recortado y en
minúsculas).

**Aceptación:**
- Al autenticarse, la app escribe o refresca la entrada del usuario actual.
- La entrada sólo puede escribirla quien demuestre ese email: la regla compara
  `emailHash` contra `hashing.sha256(request.auth.token.email.lower())`.
- La colección **no se puede listar** (`allow list: if false`); sólo se lee un
  documento concreto por su hash. Consultar un email suelto es posible —eso es
  inherente a invitar por email—; barrer el directorio, no.
- La entrada guarda `uid`, `displayName` y `photoURL`. Nada más: sin `hasOnly`,
  cualquiera podría cargar basura arbitraria en su propia entrada.

**Verificar:** tests de reglas contra el emulador, incluido el caso de un
usuario que intenta escribir en el hash del email de otro. **Confirmar en el
emulador que `hashing.sha256(...).toHexString()` está disponible en reglas de
Firestore**; si no lo estuviera, la alternativa es guardar el email en claro en
el documento y comparar contra `request.auth.token.email`, aceptando que el id
del documento deja de ser opaco.

### F2 · Compartir un evento con invitados

**Aceptación:**
- El dueño abre «Compartir» desde la tarjeta o el editor, escribe un email y
  elige rol: **lector** o **editor**.
- Si el email tiene cuenta, la persona queda añadida al instante y el evento le
  aparece sin que tenga que aceptar nada.
- Si no la tiene, el diálogo lo dice con claridad y ofrece copiar un enlace de
  registro. No se guarda ninguna invitación pendiente: sin backend no hay quien
  la aplique cuando esa persona se registre.
- El dueño ve la lista de invitados, puede cambiar el rol de cada uno y
  expulsarlos.
- **Un editor puede editar el contenido del evento y nada más**: no invita, no
  expulsa, no cambia roles, no borra el evento, no se transfiere la propiedad.
- Nadie puede autoañadirse a un evento.

**Reglas** (una única regla `allow` por operación, como manda `SPEC.md`):

```
match /events/{eventId} {
  function uid()      { return request.auth.uid; }
  function signedIn() { return request.auth != null; }
  function isOwner()  { return signedIn() && uid() == resource.data.userId; }
  function isMember() { return signedIn() && uid() in resource.data.memberIds; }
  function isEditor() { return isMember() && resource.data.roles[uid()] == 'editor'; }

  function hasRequiredFields() {
    return request.resource.data.keys()
      .hasAll(['title', 'description', 'location', 'userId', 'memberIds', 'roles']);
  }

  // La membresía y la propiedad son cosa del dueño y de nadie más.
  function membershipUnchanged() {
    return request.resource.data.userId    == resource.data.userId
        && request.resource.data.memberIds == resource.data.memberIds
        && request.resource.data.roles     == resource.data.roles;
  }

  allow read: if isMember();

  allow create: if signedIn()
                && hasRequiredFields()
                && request.resource.data.userId == uid()
                && request.resource.data.memberIds == [uid()]
                && request.resource.data.roles.keys().size() == 0;

  allow update: if hasRequiredFields()
                && (
                     (isOwner() && request.resource.data.userId == resource.data.userId)
                     || (isEditor() && membershipUnchanged())
                   );

  allow delete: if isOwner();
}
```

**Verificar:** tests de reglas para las nueve combinaciones de (dueño, editor,
lector, extraño) × (leer, editar contenido, editar membresía, borrar), más el
intento de autoascenso de un editor y el de transferencia de propiedad.

### F3 · Bandeja «Compartidos conmigo»

**Aceptación:**
- La consulta del listado pasa de `where('userId', '==', uid)` a
  `where('memberIds', 'array-contains', uid)`.
- Un conmutador filtra entre **todos**, **míos** y **compartidos conmigo**.
- Cada tarjeta compartida indica de quién es y con qué rol la tienes.
- A un lector no se le ofrecen los botones de editar ni borrar. La regla es lo
  que de verdad lo impide; la UI sólo evita la frustración.
- Los eventos creados en la fase 1 **no tienen `memberIds` y desaparecerían del
  listado**. Hace falta un backfill: `memberIds = [userId]`, `roles = {}`. Como
  no hay usuarios reales, un script puntual basta; se documenta en el plan.

**Verificar:** e2e con dos sesiones contra el emulador. Índice compuesto de
`memberIds` + `startDate` declarado en `firestore.indexes.json`.

### F4 · Exportar a calendario

**Aceptación:**
- Cada evento puede descargarse como `.ics` y abrirse en Google Calendar por
  URL de plantilla.
- La agenda completa se exporta como un único `.ics` con todos los eventos
  visibles según los filtros activos.
- El `.ics` cumple RFC 5545 en lo que importa: `UID` estable, `DTSTAMP`, escape
  de comas, puntos y comas y saltos de línea, plegado de líneas a 75 octetos, y
  `VALUE=DATE` para eventos sin hora.
- Un evento sin fechas no se exporta: se avisa en vez de generar un `.ics` roto.
- Todo en cliente: `Blob` + `URL.createObjectURL` + `<a download>`. Sin red y
  sin dependencias nuevas.

**Verificar:** unitarios sobre `buildIcs()` como función pura, con casos de
título con comas, descripción multilínea, evento de día completo y línea larga
que obliga a plegar. Un e2e comprueba que la descarga se dispara.

### F5 · Vista de calendario y vista de agenda

**Aceptación:**
- Tres vistas conmutables: rejilla de tarjetas (la actual), **calendario
  mensual** y **agenda** (lista cronológica agrupada por día).
- El calendario se construye con CSS grid e `Intl.DateTimeFormat`; **sin
  librería de calendario nueva**. El primer día de la semana y los nombres de
  mes salen del locale activo.
- La vista elegida sobrevive a la recarga (`localStorage`).
- El calendario es navegable por teclado y anuncia el mes al cambiar. Una
  rejilla de fechas es donde axe encuentra problemas: `role="grid"`, celdas
  etiquetadas con la fecha completa y foco gestionado.
- Los filtros de búsqueda, fechas y etiquetas se aplican en las tres vistas.

**Verificar:** unitarios de la función pura que reparte eventos en celdas del
mes, con el caso del evento que cruza varios días y el del cambio de horario de
verano. E2e con axe en cada una de las tres vistas.

### F6 · Etiquetas

**Aceptación:**
- Un evento tiene de cero a diez etiquetas, texto libre normalizado (recortado,
  en minúsculas, sin duplicados, máximo 24 caracteres).
- El editor ofrece autocompletado con las etiquetas que ya usa el usuario.
- Se puede filtrar por etiqueta; varias etiquetas seleccionadas se combinan con
  **Y**, no con **O**.
- Se renderizan con `wa-tag`; el color sale del hash del nombre, de forma
  estable entre recargas.
- El filtrado por etiqueta se resuelve en cliente dentro de `filterEvents`,
  igual que la búsqueda: no añade índices ni consultas.

**Verificar:** unitarios de normalización y de filtrado combinado.

### F7 · Orden y agrupación

**Aceptación:**
- Orden por fecha de inicio (ascendente o descendente), por título o por fecha
  de creación.
- Separación entre **próximos** y **pasados**, con los próximos primero por
  defecto y los pasados plegados.
- Los eventos sin fecha caen en su propio grupo y no se cuelan entre los
  fechados. Es la misma semántica que ya fija `filterEvents` para el filtro por
  rango: no se inventa una nueva.
- Preferencia recordada en `localStorage`.

**Verificar:** unitarios de la función de ordenación, incluidos empates y
eventos sin fecha.

### F8 · Crear evento desde texto pegado

**Aceptación:**
- Junto al generador desde imagen, un campo donde pegar texto suelto —el email
  de una convocatoria, un mensaje, un párrafo copiado de una web— del que la IA
  extrae los campos del evento.
- **Reutiliza la política existente** de [`ai-policy.ts`](../apps/web/src/domain/ai-policy.ts)
  y el mismo `responseSchema` que la extracción desde imagen. No se duplica la
  decisión de nube ni se añade una segunda ruta de configuración.
- El resultado prerrellena el editor y el usuario confirma antes de guardar,
  exactamente igual que con la imagen.
- Un fallo de la IA nunca bloquea el alta manual.
- Tope de longitud del texto, para acotar el gasto de tokens.

**Verificar:** unitarios con el modelo simulado: éxito, error, IA no disponible,
texto que no contiene ningún evento.

### F9 · Sugerencia de etiquetas

**Aceptación:**
- Al guardar un evento sin etiquetas, se proponen hasta tres a partir de título
  y descripción, **priorizando las que el usuario ya usa** antes que inventar
  vocabulario nuevo.
- Son sugerencias: aparecen desmarcadas y el usuario elige. Nunca se aplican
  solas.
- La función degrada a silencio: si la IA no está disponible, no se sugiere
  nada y no se muestra ningún error. Es una comodidad, no un requisito.

**Verificar:** unitarios con el modelo simulado, incluido el caso de que
devuelva etiquetas que incumplen la normalización de F6.

### F10 · Separación landing / aplicación

**Por qué existe:** la landing tiene que ser HTML real e instantáneo, y la app
es una SPA que arranca Lit, el router y el SDK de Firebase. Meter la primera
dentro de la segunda condena a todo visitante que no tiene cuenta a descargar
una aplicación que no va a usar, y deja el contenido fuera del alcance de
cualquier buscador que no ejecute JavaScript.

**Es la tarea de más riesgo de toda la fase**, porque toca el enrutado, la
guarda de sesión y el despliegue a la vez. Va primero y sola.

**Aceptación:**
- El `index.html` actual —que es la SPA— pasa a llamarse `app.html` y sigue
  siendo la única entrada de Vite. **Vite no necesita ser multipágina:** la
  landing no la construye Vite, la genera el script de F11 después.
- **La app se muda a `/app`.** `HOME_PATH` deja de ser `/` y todas las rutas
  cuelgan de ahí: `/app`, `/app/login`, `/app/profile`. `guardRedirect` redirige
  a `/app/login`, no a `/login`.
- Los rewrites de `firebase.json` dejan de mandar `**` a `/index.html`:

  ```json
  "rewrites": [{ "source": "/app/**", "destination": "/app.html" }]
  ```

  Todo lo demás se sirve como fichero estático. **El rewrite `**` actual haría
  que la landing nunca se viera**, porque cualquier URL devolvería la SPA.
- Redirecciones permanentes de `/`, `/login` y `/profile` hacia sus equivalentes
  bajo `/app`, para no romper enlaces existentes.
- Los enlaces de la landing hacia la app son `<a href="/app">`, navegación
  normal del navegador, no enrutado en cliente.
- Los e2e existentes siguen pasando con las rutas nuevas.

**Verificar:** un e2e entra a `/`, ve la landing, pulsa «Entrar» y acaba
autenticado en `/app`; los rewrites y las redirecciones probados contra el
emulador de Hosting, que es el único sitio donde se comportan como en
producción.

### F11 · Landing pública

**Cómo se construye.** La landing se escribe con `lit-html` y `msg()`, igual que
el resto del proyecto, y un script la **renderiza a HTML estático en el build**
con `@lit-labs/ssr`. Al cliente no le llega ni una línea de JavaScript: llega
HTML ya pintado.

Esto resuelve de paso el problema que tenía la landing con los idiomas.
`@lit/localize` funciona perfectamente si el render ocurre en Node, así que los
textos salen del **mismo `xliff/es.xlf` y el mismo flujo `localize:extract` →
traducir → `localize:build`** que la aplicación. Ni un HTML duplicado a mano ni
un segundo sistema de traducción.

```
scripts/build-landing.mjs
  para cada locale de locale-codes.ts:
    configureLocalization → setLocale(locale)
    render(landingTemplate())            # @lit-labs/ssr, en Node
    + CSS minificado en línea
    → dist/localized/{locale}/index.html
```

Corre **después** de `vite build`, para poder leer del manifiesto las rutas con
hash de las imágenes y las tipografías ya procesadas por Vite.

**Aceptación:**
- **0 KB de JavaScript** en la landing. Si algún día aparece una isla que de
  verdad lo necesite, se hidrata **sólo esa isla** con `@lit-labs/ssr-client`, y
  el tope es **10 KB comprimidos**. El build comprueba el tamaño y **falla si se
  pasa**: un presupuesto que no se comprueba se incumple sin que nadie se entere.
- Los componentes de la landing renderizan en **light DOM**
  (`createRenderRoot() { return this; }`). Sin shadow DOM no hay
  `<template shadowrootmode>` y por tanto no se depende de Declarative Shadow
  DOM, que acaba de cruzar a Baseline widely available y no merece el riesgo
  para algo que no lo necesita.
- **Se usan las utilidades CSS de Web Awesome** (`wa-stack`, `wa-cluster`,
  `wa-grid`, `wa-prose`) y los tokens `--wa-*`, que son CSS puro y funcionan sin
  JavaScript. **No se usan sus componentes** (`<wa-button>` y compañía): son
  custom elements y traerían JS. Un `<a>` estilado cubre la llamada a la acción.
- El CSS va **en línea en el `<head>`**, minificado. Una landing de una página
  tiene poco CSS; incrustarlo elimina una petición de la ruta crítica y hace
  trivial el «CSS crítico en línea» que pide el LCP.
- Contenido: qué es planu en una frase, tres o cuatro bloques de valor —privado
  por defecto, compartir con quien elijas, tu cartel se convierte en evento, se
  integra con tu calendario—, una captura o demostración real, y una llamada a
  la acción única y repetida.
- **Nada de lo que promete puede ser falso.** Si el `.ics` no está entregado, la
  landing no dice que se integra con tu calendario.
- SEO: `<title>` y `meta description` propios, Open Graph y Twitter Card con
  `og:image`, `<link rel="alternate" hreflang>` entre idiomas, datos
  estructurados JSON-LD de tipo `SoftwareApplication`, `robots.txt` y
  `sitemap.xml`.
- Selección de idioma con la **i18n nativa de Firebase Hosting**, que sirve por
  `Accept-Language` desde el directorio de cada idioma:

  ```json
  "i18n": { "root": "/localized" }
  ```

  El prerender ya deja los ficheros donde toca. **Confirmar que convive con los
  rewrites de F10** antes de comprometerse; si no lo hiciera, la alternativa es
  una redirección por `Accept-Language` hacia `/es/` o `/en/`.
- Rendimiento: **LCP < 1,5 s** en 4G simulada y CLS < 0,1. Sin fuentes
  bloqueantes, imágenes con `width`/`height` y en formatos modernos.
- Accesible: un solo `<h1>`, jerarquía de encabezados correcta, contraste
  suficiente, navegable con teclado, y axe sin violaciones.
- Pie con enlaces a privacidad y términos (F13).

**Verificar:** e2e con axe sobre la landing en los dos idiomas; test del build
que comprueba que el HTML generado no contiene ninguna etiqueta `<script>`;
comprobación del presupuesto de bytes; auditoría Lighthouse con umbral de
rendimiento y SEO en 100 (usar `/webperf`).

### F12 · Identidad visual propia

**Por qué existe:** hoy la app usa el tema por defecto de Web Awesome, que es
correcto y de nadie. Y arrastra una deuda: [`docs/blueprint.md`](blueprint.md)
propone indigo `#3F51B5` con las tipografías Belleza y Alegreya, decisión
heredada del prototipo que **nunca se ha revisado ni aplicado**.

**Aceptación:**
- Se decide explícitamente si se adopta la paleta del blueprint, se ajusta o se
  descarta, y queda escrito en un ADR. Cualquiera de las tres es válida; lo que
  no vale es seguir sin decidir.
- La decisión se traduce a **tokens `--wa-*`** en una hoja de tema única
  compartida por landing y app. No hay colores sueltos en los componentes.
- Contraste **AA como mínimo** en todas las combinaciones de texto y fondo, la
  paleta verificada, no supuesta.
- Modo claro y oscuro, respetando `prefers-color-scheme`.
- Las tipografías se **sirven desde el propio dominio**, no desde el CDN de
  Google Fonts: por rendimiento y porque cargarlas desde Google filtra la IP del
  visitante a un tercero, lo que choca con lo que dirá F13. Subconjunto latino y
  `font-display: swap`.
- Logotipo, favicon, icono de aplicación y `og:image`.
- La aplicación adopta el tema sin regresiones visuales.

**Verificar:** el contraste con axe en e2e —que ya cubre AA— más una tabla de
comprobación de la paleta. La skill `webawesome-design` es la referencia de
tokens y `frontend-design` la de dirección visual.

### F13 · Privacidad, términos y cookies

**Por qué existe:** planu guarda nombre, email, foto, ubicaciones y las imágenes
que sube el usuario, y los procesa Google. En cuanto se abre a terceros en la
UE, informar deja de ser cortesía.

**Aceptación:**
- **Política de privacidad** que diga lo que de verdad ocurre: qué datos se
  guardan, dónde (Firebase, con su región), cuánto tiempo, quién los procesa,
  y que las imágenes se envían a Gemini cuando la generación se resuelve en la
  nube y **no** cuando se resuelve en el dispositivo. Esa distinción es un
  argumento de venta y hay que contarla.
- **Términos de servicio** proporcionados a un producto sin plan de pago: sin
  garantías, sin SLA, con causas de baja.
- **Aviso de cookies** sólo si F16 acaba usando algo que las requiera. Si la
  analítica elegida no pone cookies ni identificadores persistentes, no se pone
  banner: un banner innecesario es peor producto y peor rendimiento.
- Ambos textos disponibles en los dos idiomas y enlazados desde el pie de la
  landing y desde el perfil. Se generan con **el mismo prerender de F11**: son
  páginas estáticas sin JavaScript, no rutas de la aplicación.
- Página de contacto o email de responsable.
- **No son documentos generados y olvidados**: si el modelo de datos cambia, la
  política cambia con él.

**Verificar:** revisión manual contra el modelo de datos real; enlaces vivos
comprobados por e2e. Un abogado no está en el alcance, y eso se dice aquí
explícitamente: son textos honestos, no asesoramiento legal.

### F14 · Borrado de cuenta y de datos

**Por qué existe:** prometer en F13 que el usuario puede irse obliga a que
pueda irse de verdad. Y es la única funcionalidad de producto que es **código
delicado**, no contenido.

**Aceptación:**
- Desde el perfil, «Borrar mi cuenta» con confirmación escribiendo el email, no
  un simple «¿seguro?».
- Borra, en este orden: los eventos de los que es dueño, sus imágenes en
  Storage, su entrada en `userDirectory`, su membresía en los eventos ajenos de
  los que era invitado, y por último la cuenta de Auth.
- **Salir de un evento ajeno es un caso que las reglas de F2 no permiten**: allí
  sólo el dueño toca `memberIds`. Hay que abrir una excepción acotada —un
  usuario puede quitarse a sí mismo, y sólo a sí mismo, de `memberIds` y
  `roles`— o aceptar que quedan membresías huérfanas. **Se decide antes de
  escribir las reglas de F2**, no después.
- `deleteUser()` exige autenticación reciente: si falla con
  `auth/requires-recent-login`, se pide reautenticar y se reanuda.
- Si el borrado se interrumpe a medias, al volver a entrar se puede reintentar.
  Sin backend no hay transacción posible; que sea reanudable es lo mejor
  alcanzable y hay que decirlo.
- Los eventos de los que era dueño y estaban compartidos **desaparecen para sus
  invitados**. Se avisa en la confirmación.

**Verificar:** e2e completo contra los emuladores, con un usuario que tiene
eventos propios, imágenes y una membresía ajena; se comprueba que no queda nada
suyo en Firestore ni en Storage.

### F15 · Onboarding y primera sesión

**Aceptación:**
- El estado vacío deja de ser un hueco: explica qué hacer, con acciones directas
  para crear el primer evento a mano, desde una imagen o desde texto pegado.
- Se ofrece **crear un evento de ejemplo** que el usuario puede editar o borrar.
  Se crea sólo si lo pide; nunca aparece solo en su cuenta.
- La generación con IA se presenta la primera vez que se ve el listado, no
  escondida detrás de un icono.
- Nada de tour modal por encima de la interfaz: la ayuda vive en el estado
  vacío, donde no estorba a quien ya sabe.
- El estado vacío distingue —como ya hace hoy— «no tienes eventos» de «tu
  búsqueda no encuentra nada», y sólo el primero enseña.

**Verificar:** e2e de usuario recién registrado que llega a crear su primer
evento sin salir del estado vacío; axe sobre él.

### F16 · Analítica de activación

**Por qué existe:** sin números, «darle forma de producto» es una opinión. Con
cuatro eventos bien elegidos se sabe si la gente se registra, si llega a crear
algo y si vuelve.

**Aceptación:**
- Se miden pocas cosas y concretas: visita a la landing, registro completado,
  **primer evento creado** (la activación de verdad), evento compartido, y uso
  de la generación con IA.
- **Nunca se envía contenido del usuario**: ni títulos, ni descripciones, ni
  ubicaciones, ni el texto que se pega en F8. Sólo que la acción ocurrió.
- La analítica **no debe poder romper la aplicación**: carga diferida, errores
  tragados, y la app funciona igual si el bloqueador del navegador la impide.
- Si el proveedor elegido usa cookies o identificadores persistentes, no se
  carga hasta que haya consentimiento, y rechazar es tan fácil como aceptar. Si
  no los usa, no hay banner (ver F13).
- El proveedor queda por decidir: Firebase Analytics es lo que ya está en el
  stack pero pone cookies y obliga al banner; una alternativa sin cookies evita
  el banner a cambio de una dependencia nueva. **Es una pregunta abierta.**

**Verificar:** unitarios del envoltorio de eventos, incluido que traga errores y
que no filtra campos del evento. E2e que confirma que la app arranca con la
analítica bloqueada.

## Modelo de datos

Cambios sobre [`docs/backend.json`](backend.json), que hay que actualizar:

```ts
// apps/web/src/lib/types.ts — campos nuevos del esquema Zod
memberIds: z.array(z.string()).default([]),
roles: z.record(z.string(), z.enum(["viewer", "editor"])).default({}),
tags: z.array(z.string()).max(10).default([]),
createdAt: z.coerce.date().optional(),   // necesario para ordenar por creación (F7)
```

Colección nueva:

```
userDirectory/{sha256Hex(email)}
  uid: string
  displayName: string
  photoURL: string
```

`userId` no cambia de significado ni deja de ser obligatorio.

## Comandos

Los mismos de `SPEC.md`, sin añadidos. Dos que esta fase usa más que la
anterior:

```bash
npm run emulators                                   # auth 9099, firestore 8181, storage 9199
npm run localize:extract && npm run localize:build  # tras cada texto nuevo
```

Comandos nuevos:

```bash
npm run build:landing   # prerender por idioma; corre tras vite build
npm run build           # tsc --noEmit && vite build && build:landing
```

F10 y F11 necesitan además el **emulador de Hosting**, ya configurado en el
puerto 5050: es el único sitio donde se pueden probar los rewrites, las
redirecciones y la i18n sin desplegar. `npm run emulators` hoy no lo arranca;
hay que añadirlo.

`@lit-labs/ssr` es dependencia **de desarrollo** —sólo corre en el build, nunca
se envía al navegador— y ya está aprobada. `@lit-labs/ssr-client` sólo entraría
si aparece una isla que hidratar, y esa decisión se toma entonces.

Los tests de reglas de seguridad **ya están montados**:
`@firebase/rules-unit-testing` instalado, `npm run test:rules` con
`vitest.rules.config.ts`, y `apps/web/rules/firestore.test.ts` cubriendo
privacidad, propiedad y forma del documento. Esta fase amplía ese arnés; no lo
construye.

Todos ellos, y los e2e con datos sembrados, **necesitan Java en el PATH** para
los emuladores de Firestore y Storage.

## Estructura

Ficheros nuevos, dentro de la organización ya existente:

```
apps/web/src/
  sharing/
    user-directory.ts        Hash del email, alta y consulta en userDirectory
    user-directory.test.ts
    share-dialog.ts          <planu-share-dialog>: invitar, cambiar rol, expulsar
    permissions.ts           canEdit / canDelete / canShare a partir del evento y el uid
    permissions.test.ts
  calendar/
    build-ics.ts             Serialización RFC 5545
    build-ics.test.ts
    google-calendar-url.ts
    calendar-view.ts         <planu-calendar-view>: rejilla mensual
    month-grid.ts            Reparto puro de eventos en celdas
    month-grid.test.ts
    agenda-view.ts           <planu-agenda-view>
  events/
    tags.ts                  Normalización y filtrado por etiqueta
    tags.test.ts
    sort-events.ts
    sort-events.test.ts
    generate-from-text.ts    F8, junto a generate-event.ts
    suggest-tags.ts          F9
  lib/
    view-preferences.ts      Vista, orden y agrupación en localStorage
  account/
    delete-account.ts        F14: borrado en cascada, reanudable
    delete-account.test.ts
  analytics/
    track.ts                 F16: envoltorio que traga errores y filtra campos
    track.test.ts
firestore.indexes.json       Índice memberIds + startDate
tests/rules/                 Tests de reglas con el emulador
```

Territorio de producto, fuera de `src/` porque la landing no es la aplicación:

```
apps/web/
  app.html                   F10: la SPA, única entrada de Vite (antes index.html)
  src/landing/
    landing.ts               Plantillas lit-html con msg(); light DOM
    hero.ts, features.ts, footer.ts
    landing.css              Estilos propios, se incrustan en el HTML
    legal.ts                 F13: plantilla común de las páginas legales
    landing.test.ts          Render en Node: contenido, hreflang, sin <script>
  src/styles/
    theme.css                F12: tokens --wa-*, compartido por landing y app
  public/
    robots.txt, sitemap.xml
    fonts/                   F12: tipografías autoalojadas
  assets/landing/
    hero.webp, og.png
scripts/
  build-landing.mjs          Prerender por idioma + presupuesto de bytes
```

Salida del build:

```
apps/web/dist/
  app.html                   La SPA
  assets/                    Bundle de la app, con hash
  localized/es/index.html    Landing en español, 0 KB de JS
  localized/es/privacy.html  Legales, mismo prerender
  localized/es/terms.html
  localized/en/…             Lo mismo en inglés
```

`firebase.json` cambia rewrites, redirecciones, cabeceras e i18n.
`package.json` gana `build:landing`, encadenado tras `vite build`.

## Estilo de código

Sin cambios respecto a `SPEC.md`. La regla que esta fase tensa más es la de
**separar la lógica pura del componente**: cada funcionalidad de aquí tiene un
núcleo testeable sin DOM. Los permisos, por ejemplo, viven en una función y no
repartidos por plantillas:

```ts
import type { StoredEvent } from "../lib/types.js";

/** Rol de una persona sobre un evento. `null` si no tiene acceso. */
export type EventRole = "owner" | "editor" | "viewer";

/**
 * La UI usa esto para decidir qué botones enseña. Quien de verdad lo impide son
 * las reglas de Firestore: esta función evita frustración, no accesos.
 */
export function roleFor(event: StoredEvent, uid: string): EventRole | null {
	if (event.userId === uid) return "owner";
	if (!event.memberIds?.includes(uid)) return null;
	return event.roles?.[uid] === "editor" ? "editor" : "viewer";
}

export const canEdit = (event: StoredEvent, uid: string) =>
	roleFor(event, uid) !== null && roleFor(event, uid) !== "viewer";
```

## Estrategia de tests

Los tres niveles de `SPEC.md` siguen igual, con **un cuarto nivel nuevo**:

- **Tests de reglas de seguridad** (`apps/web/rules/*.test.ts`), ya existentes y
  que esta fase amplía. Es el único nivel que demuestra F1 y F2: un e2e con dos
  sesiones prueba que la UI se comporta, no que la puerta esté cerrada. Toda
  regla nueva llega con su test del caso que **deniega**, no sólo del que
  permite, y ese test se escribe **antes** que la regla.
- **Unitarios de lógica pura**: `buildIcs`, `monthGrid`, `normalizeTags`,
  `sortEvents`, `roleFor`, el hash del email. Aquí van los casos límite.
- **Unitarios de componentes** en Chromium real.
- **E2e con axe**, ahora también sobre calendario, agenda, landing, legales y
  diálogo de compartir. El calendario es lo más propenso a violaciones de
  accesibilidad de todo lo que hay en el proyecto.
- **Tests del prerender** (F11), que corren **en Node y no en el navegador**:
  son la excepción a la regla de Chromium real, porque lo que prueban es
  precisamente el render fuera del navegador. Comprueban que la plantilla emite
  el contenido esperado en los dos idiomas, que el `hreflang` es correcto y que
  el HTML **no contiene ninguna etiqueta `<script>`**.
- **Presupuesto de rendimiento en la landing** (F11): Lighthouse con umbrales, y
  el tope de bytes comprobado por el propio build. Es lo único de esta fase que
  se mide en milisegundos y en kilobytes.

La IA se sigue simulando. Nunca se prueba contra el modelo real.

## Fronteras

Las de `SPEC.md` siguen vigentes. Añade esta fase:

**Siempre:**
- Toda regla nueva llega con un test que comprueba que **deniega** a quien debe
  denegar.
- El `uid` de un miembro se resuelve contra `userDirectory`, nunca se acepta un
  `uid` escrito a mano en la interfaz.
- La UI oculta acciones según el rol, pero **jamás se confía en ello**: la regla
  es la autoridad.
- Cada vista nueva pasa por axe antes de darse por terminada, landing y páginas
  legales incluidas.
- Los colores nuevos salen de tokens `--wa-*`, nunca escritos a mano en un
  componente.
- La política de privacidad se revisa cuando cambia el modelo de datos.

**Preguntar primero:**
- Añadir cualquier dependencia.
- Ejecutar el backfill de `memberIds` sobre datos que no sean del emulador.
- Cualquier cosa que reintroduzca Cloud Functions o Blaze.
- Registrar un dominio propio o tocar la configuración DNS.
- Elegir proveedor de analítica: condiciona si hace falta banner de cookies.

**Nunca:**
- Permitir que alguien se añada a sí mismo como miembro de un evento (salvo la
  excepción acotada de F14: quitarse a uno mismo).
- Permitir que un editor toque `memberIds`, `roles` o `userId`.
- Listar `userDirectory` entero, ni exponer emails de terceros en la interfaz.
- Dar por buena una etiqueta o un texto de la IA sin pasarlo por la validación
  de Zod.
- Mandar contenido del usuario a la analítica.
- Prometer en la landing algo que la aplicación todavía no hace.
- Cargar la landing con JavaScript de la aplicación o con el SDK de Firebase.
- Usar **componentes** de Web Awesome en la landing; sus utilidades CSS y sus
  tokens, todos los que hagan falta.
- Subir el tope de 10 KB para que quepa algo, en vez de replantear ese algo.
- Servir tipografías desde un CDN de terceros.

## Criterios de éxito

1. El dueño invita por email a una segunda cuenta como **lector**; ésta ve el
   evento y **las reglas** —no sólo la UI— le impiden editarlo y borrarlo.
2. Ascendida a **editor**, puede cambiar el contenido, y las reglas siguen
   impidiéndole invitar, expulsar, cambiar roles y borrar.
3. Un extraño no lee, no escribe y no aparece; verificado con test de reglas.
4. Un editor no puede ascenderse a sí mismo ni quedarse con la propiedad.
5. Escribir en el directorio con el hash del email de otra persona es denegado.
6. El `.ics` de un evento se abre correctamente en Calendario de macOS y en
   Google Calendar, con título, fechas, ubicación y descripción intactos,
   incluida una descripción con comas y saltos de línea.
7. Con sesenta eventos, la vista de calendario los sitúa en su día correcto y el
   filtro por etiqueta reduce el listado en las tres vistas.
8. Pegar el texto de una convocatoria produce un borrador con título y fechas
   correctos, revisable antes de guardar, y su fallo no impide el alta manual.
9. Cero violaciones de axe en las tres vistas y en el diálogo de compartir.
10. Un visitante llega a `/`, entiende qué es planu sin preguntar a nadie, y
    llega a `/app` de un clic. La landing **no envía una sola línea de
    JavaScript** —verificable: el HTML no tiene `<script>`— y su LCP baja de
    1,5 s en 4G simulada. Con JavaScript desactivado se ve y se navega igual.
11. La landing se sirve en español o en inglés según el navegador, con sus
    textos saliendo del mismo XLIFF que la aplicación, y comparte identidad
    visual con ella: los mismos tokens, no un parecido.
12. La política de privacidad describe el tratamiento real, incluida la
    diferencia entre generar en el dispositivo y generar en la nube.
13. Un usuario borra su cuenta y no queda rastro suyo en Firestore, en Storage
    ni en `userDirectory`, verificado contra los emuladores.
14. Un usuario recién registrado crea su primer evento partiendo del estado
    vacío, sin ayuda externa.
15. La aplicación funciona con la analítica bloqueada por el navegador, y la
    analítica no lleva ni un solo campo de contenido del usuario.
16. `npm run build`, `npm test`, `npm run test:e2e` y `npm run lint` limpios.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La URL de descarga de Storage lleva un token que **salta las reglas**: quien vio la imagen de un evento la sigue viendo tras ser expulsado | Documentarlo. Revocar el token exige el SDK de Admin o la consola; no hay solución en cliente. Si resulta inaceptable, hay que replantear el almacenamiento de imágenes en un ADR propio |
| Los eventos de la fase 1 no tienen `memberIds` y se vuelven invisibles | Backfill antes de desplegar; sin usuarios reales todavía, el coste es cero **si se hace ahora** |
| `roles` como map en el documento crece sin límite | Tope de invitados por evento validado en la regla (`roles.keys().size() <= 20`) |
| Consultar `userDirectory` confirma si un email está registrado | Inherente a invitar por email. Se acota prohibiendo el listado; no se resuelve del todo sin backend |
| La vista de calendario es el punto más probable de fallo de accesibilidad | Teclado y roles ARIA desde el primer commit, no al final; axe en e2e |
| F8 abre una segunda vía de gasto de tokens | Misma política de `ai-policy.ts`, sin excepciones, más tope de longitud del texto |
| Zonas horarias entre Firestore, `.ics` y la rejilla mensual | Toda conversión pasa por funciones puras con tests, incluido el cambio de horario de verano |
| **F10 rompe el enrutado y el despliegue a la vez.** El rewrite `**` vigente devolvería la SPA para cualquier URL y la landing no se vería nunca | Va primero, sola y con su propio commit; e2e de las rutas nuevas antes de tocar nada más; probar contra el emulador de Hosting (puerto 5050) antes de desplegar |
| La i18n de Hosting y los rewrites de F10 pueden no convivir bien | Comprobarlo en el emulador **antes** de escribir la landing. Alternativa: redirección por `Accept-Language` hacia `/es/` o `/en/` |
| `@lit-labs/ssr` está en `labs`: API sin estabilizar y puede cambiar | Se usa **sólo en el build**, para nuestras propias plantillas y sin hidratar. Si un día rompe, el peor caso es congelar la versión o generar el HTML de otro modo: no afecta a lo que corre en el navegador |
| El prerender de Lit obliga a Declarative Shadow DOM | Se esquiva: los componentes de la landing renderizan en light DOM. Es también la razón de no usar componentes de Web Awesome ahí |
| El presupuesto de 0 KB se erosiona con «esto son sólo 2 KB» | El build comprueba el tamaño y falla. Está además en las fronteras como «nunca» |
| Enlaces antiguos a `/`, `/login` o `/profile` dejan de funcionar | Redirecciones permanentes en Hosting hacia las rutas de `/app` |
| F14 borra en cascada sin transacción: un fallo a medias deja datos huérfanos | Orden de borrado que deja la cuenta de Auth para el final, y reanudable en el siguiente acceso |
| La política de privacidad envejece en cuanto cambia el modelo de datos | Está en las fronteras: cambiar el modelo obliga a revisarla |
| «Darle forma de producto» es un pozo sin fondo | Delimitado a siete funcionalidades con criterios verificables. Precios, marketing y dominio quedan fuera |

## Preguntas abiertas

1. **Java no está instalado.** Sin él no arrancan los emuladores de Firestore y
   Storage, y sin ellos no corren ni `npm run test:rules` ni los e2e con datos
   sembrados: la mitad de los criterios de éxito quedan sin verificar. Se
   resuelve con `brew install openjdk` y añadirlo al PATH.
2. **Invitar a quien todavía no tiene cuenta**: la propuesta lo resuelve con un
   «esa persona aún no está registrada». Un flujo de invitación pendiente de
   verdad necesita Cloud Functions, y eso es Blaze.
3. ~~**`hashing.sha256().toHexString()` en reglas de Firestore.**~~
   **Resuelto** (T12): existe y coincide exactamente con
   `createHash("sha256").digest("hex")` de Node. Verificado contra el emulador.
   También se confirmaron `List.removeAll()` y `Map.diff().affectedKeys()`, que
   son lo que hace expresable «salir de un evento». Ver
   [ADR 0007](adr/0007-client-side-user-directory.md).
4. **Notificación al invitado**: ahora mismo se entera al abrir la app. Avisarle
   por email exige backend.
5. ~~**Salir de un evento ajeno** (F14).~~ **Resuelto** (T12): sí, un usuario
   puede quitarse a sí mismo y sólo a sí mismo, y el dueño no puede irse del
   suyo. Las reglas pueden expresarlo con precisión. Ver
   [ADR 0006](adr/0006-sharing-with-invited-members.md).
6. **Proveedor de analítica** (F16): Firebase Analytics ya está en el stack pero
   obliga a banner de cookies; una alternativa sin cookies lo evita a cambio de
   una dependencia. La elección determina si F13 lleva banner.
7. **Paleta y tipografías** (F12): adoptar el indigo `#3F51B5` con Belleza y
   Alegreya del blueprint, ajustarlo o descartarlo. Esto **resuelve por fin** la
   deuda que `docs/blueprint.md` arrastra desde la fase 1.
8. **Dominio propio**: hoy se sirve en el dominio de Firebase Hosting. Un
   producto que se enseña normalmente quiere el suyo, y eso es registro, DNS y
   coste recurrente.
9. **Textos legales**: quién los escribe. Aquí se especifica que sean honestos y
   fieles al tratamiento real, no que sean asesoramiento jurídico.

## ADRs a escribir

| Nº | Título | Cuándo |
| --- | --- | --- |
| 0004 | Compartición por invitados con rol (supersede parcialmente el 0002) | Antes de tocar `firestore.rules` |
| 0005 | Directorio de usuarios en cliente frente a Cloud Functions | Junto al 0004 |
| 0006 | Export a calendario en lugar de recordatorios propios | Antes de F4 |
| 0007 | Landing estática separada y mudanza de la app a `/app` | Antes de F10 |
| 0008 | Identidad visual: qué se conserva del blueprint y qué se descarta | Antes de F12 |
| 0009 | Analítica y consentimiento: proveedor y qué se mide | Antes de F16 |
