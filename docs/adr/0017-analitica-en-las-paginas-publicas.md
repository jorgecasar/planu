# 0017 · Analítica en las páginas públicas, tras consentimiento

- **Fecha:** 2026-11-15 · **Estado:** propuesto; pendiente de decisión del responsable y de revisión legal
- **Enmienda:** [0009](0009-analitica-de-activacion.md) (el 0009 sigue vigente en lo que no toca este ADR; no se reescribe) · **Complementa:** la spec de la landing, [`spec-landing-registro.md`](../spec-landing-registro.md), secciones 7, 8 y 17 · **Issue:** GH-271 (por confirmar: puede abrirse una issue propia para la rodaja de medición)

Todo lo marcado **«verificar»** no se ha comprobado en el código ni en un
entorno; lo marcado **«revisión legal»** no lo decide un ingeniero.

## Contexto

El responsable ha decidido (spec, sección 17) medir «todo», incluida la
landing, y **mantener el aviso de cookies** en ella. Eso contradice dos cosas
que la landing se diseñó para cumplir:

- Los supuestos 4 y 5 de la spec (sección 1): «ningún rastreador nuevo» y la
  landing sin JavaScript.
- El presupuesto de rendimiento (sección 8): 0 B de JavaScript, 0 orígenes
  ajenos. El e2e lo hace cumplir hoy: el único `<script>` permitido es el
  JSON-LD (`apps/web/e2e-landing/landing.spec.ts:97-106`).

También se dijo que las imágenes del hero son ilustraciones generadas con IA.
Eso **no** cambia nada de lo que sigue, salvo que obliga a volver a medir el
LCP cuando se sustituyan (ver «Rendimiento»).

### Qué corre hoy (comprobado en el código de `main`)

**Analítica de producto (Firebase Analytics / GA4).**

- Puerto `AnalyticsPort` con cuatro métodos: `trackSignUp`,
  `trackFirstEventCreated`, `trackShare`, `trackAiUsed`
  (`apps/web/src/application/ports/analytics.ts:17-26`). `page_view` no está en
  el puerto: lo emite el SDK por su cuenta (mismo fichero, líneas 5-8).
- Adaptador GA4 en `apps/web/src/infrastructure/firebase/analytics-adapter.ts`.
  Sin `VITE_FIREBASE_MEASUREMENT_ID` devuelve `noopAnalytics` (línea 29); con
  él importa `firebase/analytics` de forma diferida, comprueba `isSupported()`
  y traga cualquier fallo (líneas 31-65). Parámetros enviados: ninguno en
  `sign_up`; `totalEvents: 1` constante en `first_event_created` (línea 52);
  `editable` (booleano) en `share`; `fromImage` (booleano) en `ai_used`.
  Nunca contenido del usuario.
- Se arranca en `connectedCallback()` del proveedor de Firebase, **sin esperar
  a la sesión ni a ningún consentimiento**
  (`apps/web/src/infrastructure/firebase/firebase-provider.ts:236-241`).
- Dónde se dispara cada evento: `sign_up` tras el `await` del alta
  (`apps/web/src/application/sign-up.ts:22`), `first_event_created` en
  `save-event.ts:61-64` si `request.isFirstEvent()`, `share` en
  `sharing/share-dialog.ts:302`, `ai_used` en
  `events/ai-event-generator.ts:424`.
- La medición solo corre en la **aplicación** (`/app`, `app.html`), que carga
  Firebase. La landing no carga JavaScript, así que no mide nada
  (`landing.spec.ts:97-106`; spec, sección 7).
- La variable `VITE_FIREBASE_MEASUREMENT_ID` sale de las variables del
  repositorio en CI (`.github/workflows/ci.yml:172`). **Verificar** que está
  definida en producción: sin ella nada de esto se envía hoy.

**Otros datos que salen del navegador hacia terceros, sin consentimiento.**

- **Firebase Performance**: `getPerformance(app)` tras el primer pintado y en
  reposo, fuera de `DEV` (`.../firebase/observability.ts:11-26`). No depende de
  ninguna variable: corre siempre en producción. Qué envía exactamente
  (URL, métricas de red, identificador de instalación de Firebase):
  **verificar**.
- **Sentry**: solo con `VITE_SENTRY_DSN`; `sendDefaultPii` sin declarar, es
  decir `false`, «no hay razón para enviar cabeceras ni IP»
  (`apps/web/src/infrastructure/sentry/index.ts:52-92`). Sin Replay ni trazas
  (`tracesSampleRate: 0`, integraciones explícitas). La CSP admite dos
  regiones, `*.ingest.sentry.io` y `*.ingest.de.sentry.io`
  (`firebase.json:50`); cuál usa el DSN real y si Sentry infiere la IP en el
  servidor: **verificar**.

**Consentimiento.** No existe. En el código no hay ningún estado, API ni
banner de consentimiento (búsqueda de `consent` y `cookie` en `apps/web/src`:
solo el aviso informativo). El aviso es `cookiesNotice()`
(`apps/web/src/landing/legal.ts:248-259`): un párrafo, sin botones, en el pie de
cada página de la landing (`apps/web/src/landing/landing.ts:215-235`) y en las
páginas legales (`legal.ts:53`). Su propio comentario explica por qué no es
interactivo: pedir consentimiento exige guardar la elección, es decir,
JavaScript (`legal.ts:242-246`). **No hay aviso dentro de la aplicación**,
que es donde la analítica corre de verdad. Conclusión: hoy GA4 se carga en la
aplicación antes de cualquier aceptación, y el aviso informa pero no controla.
Si eso es admisible es una pregunta de **revisión legal**; este ADR la hace
urgente, no la crea.

**Política de privacidad** (`legal.ts:136-141` y `143-148`, y sus claves en
`apps/web/src/generated/locales/es.js:22` y `:234`): dice que se cuentan cinco
cosas (visita, registro, primer evento, compartir, IA), que nunca se envía lo
escrito, que GA guarda «un pequeño identificador» y que Sentry puede recibir
un informe sin datos personales «si el despliegue lo tiene configurado». No
menciona Firebase Performance, ni la IP, ni el país de destino, ni la base
legal, ni la retención, ni cómo retirar el consentimiento. Todo eso falta.

**CSP** (`firebase.json:50`, una sola cabecera para `**`, es decir, landing y
aplicación por igual). Ya admite: `script-src` con
`https://*.googletagmanager.com`; `img-src` con
`https://*.google-analytics.com` y `https://*.googletagmanager.com`;
`connect-src` con `https://*.google-analytics.com`,
`https://*.analytics.google.com`, `https://*.googletagmanager.com` y
`https://*.googleapis.com`. Es decir, el cambio de CSP que pidió el 0009 **ya
está hecho y vale también para la landing**. No hay `unsafe-inline` en
`script-src`.

**Rendimiento.** La landing parte de 0 B de JavaScript, 0 orígenes ajenos y
HTML con tope de 24 KB en el build (`scripts/build-landing.js:52`). La
aplicación ya pagó un coste medido por cargar observabilidad pronto: Sentry y
Firebase Performance competían con el LCP (1142-1251 ms de descarga con LCP
en 1481 ms) y por eso se difieren con `afterMainPaint`
(`apps/web/src/infrastructure/sentry/index.ts:26-44`;
`docs/perf/2026-08-16-linea-base.md`). El LCP de producción sin sesión osciló
entre 1,4 y 3,2 s en esa línea base, y la spec (sección 8) pide una mediana
≤ 2,5 s sobre cinco pasadas.

## Decisión

Se **propone** (no está aceptada) medir la landing con el proveedor que ya se
eligió, Firebase Analytics, **solo tras un consentimiento explícito**, y
extender la misma puerta a la aplicación.

### 1. Qué se mide y qué no

Embudo de cuatro pasos, un evento o parámetro por paso, sin nombres nuevos
que el SDK ya cubra:

| Paso | Cómo se mide | Estado |
| --- | --- | --- |
| Visita a la landing | `page_view` automático del SDK en `/`, `/es/`, `/en/` | Nuevo (hoy la landing no mide) |
| Clic en el CTA del hero y del cierre | Parámetro `?cta=hero` / `?cta=closing` en el enlace, recogido por el `page_view` de `/app/login` (ver 4) | Nuevo; reabre D9 |
| Registro | `sign_up` (ya existe) | Existe |
| Primer evento creado | `first_event_created` (ya existe) | Existe |

`share` y `ai_used` se quedan como están (0009). **Conversión**: la
conversión primaria es `sign_up`; la de activación es `first_event_created`.
Visita y clic en el CTA son pasos intermedios del embudo, no conversiones: se
usan para saber *dónde* se pierde la gente. Tasas: visita→CTA, CTA→registro,
registro→primer evento.

Tampoco se mide, ni ahora ni después: título, descripción, lugar, fechas ni
ninguna cadena escrita por la persona; ni emails, ni uid como parámetro, ni
mapas de calor ni grabaciones de sesión; ni Google Signals ni publicidad
(coherente con el 0009, que no añadió `doubleclick.net`). Se desactivan en
la consola de GA4 los datos de publicidad y se fija la retención mínima
(**verificar** valores disponibles, y quién tiene acceso a la cuenta de GA).

Aviso de coherencia: el puerto documenta `first_event_created` como «al primer
evento que la cuenta llega a ver, propio o compartido»
(`analytics.ts:20-21`), el 0009 como «al primer `addDoc`», y el código lo
dispara en la creación si `isFirstEvent` (`save-event.ts:61-64`). La
conversión de activación debe definirse sobre el comportamiento real del
código; **verificar** de dónde sale `isFirstEvent`
(`event-editor.ts:104`) antes de fijar el KPI.

### 2. Consentimiento

- **No se carga nada de analítica hasta aceptar**: ni el SDK, ni
  `googletagmanager.com`, ni cookies ni `localStorage` de GA. Antes de aceptar
  la landing sigue con 0 orígenes ajenos.
- Un banner con «Aceptar» y «Rechazar» **de igual peso visual**, que sustituye
  al párrafo informativo actual (`cookiesNotice()`), y un enlace permanente en
  el pie para cambiar la elección. Detalles exactos del banner (qué debe
  decir, si se admite un «configurar»): **revisión legal**.
- La elección se guarda en `localStorage` del origen propio (una clave,
  versionada, con fecha) y la lee igual la landing y la aplicación: se acepta
  una vez, no dos. Landing y app comparten origen (`planu-app.web.app`);
  **verificar** que sigue siendo así si se añade dominio propio.
- La puerta vive en un único sitio: el adaptador no inicializa GA hasta que
  hay consentimiento, y el puerto sigue sin saber que existe Firebase (se le
  añade, como mucho, la noción de consentimiento concedido/retirado).
  Retirarlo detiene la medición y borra el identificador.
- **Qué se puede medir sin consentimiento: casi nada del lado del cliente, y
  este ADR lo acepta.** Sin script no hay nada que registrar. Quedan señales
  gruesas sin identificar a nadie: Search Console para el tráfico orgánico y las
  métricas de ancho de banda de Hosting (cuentan peticiones, no personas;
  **verificar** qué ofrece la consola). Son útiles para la tendencia, no para
  el embudo. El embudo medido sólo cubre a quien acepta: **sesgo de
  selección**; la proporción de aceptación se desconoce hasta medirla y las
  tasas del embudo no serán las de toda la audiencia.
- Se descarta, como base, el modo de consentimiento de Google en «denegado»
  con pings sin cookies: sigue enviando peticiones a Google (con IP) sin
  aceptación, y su encaje legal es dudoso. Es una pregunta de **revisión
  legal**, no una opción por defecto.

### 3. RGPD y ePrivacy (todo lo siguiente requiere revisión legal)

Lo que sigue es un mapa de riesgos de ingeniería, no un dictamen.

- **Datos en juego.** IP de la visita (la recibe Google al servir el script y
  la medición, aunque GA4 no la almacene; **verificar** la afirmación en la
  documentación vigente de Google), identificador de cliente en cookies/`localStorage`
  (el 0009 lo reconoce, ADR 0009 «Consecuencia para T30»), URL visitada con su
  `?cta=`, `page_referrer`, agente de usuario y país aproximado. El
  identificador y la IP son datos personales; la combinación con la cuenta de
  Google de la persona (Signals) queda desactivada.
- **Base legal.** Consentimiento: el art. 6.1.a del RGPD para el tratamiento
  y el art. 22.2 de la LSSI-CE para escribir/leer en el terminal. El interés
  legítimo no cubre la escritura de cookies de medición. Condiciones de la
  guía de la AEPD sobre cookies (rechazar tan fácil como aceptar, sin muros,
  retirada fácil, caducidad de la elección): **verificar** versión vigente.
- **Transferencia a terceros y fuera de la UE.** Google actúa como encargado
  del tratamiento con sus términos de tratamiento de datos (**verificar** que
  están aceptados en la cuenta de GA) y envía datos a EE. UU. bajo el marco
  de privacidad UE-EE. UU. (**verificar** vigencia a fecha de despliegue).
  Existen resoluciones de autoridades europeas contra el uso de Google
  Analytics por transferencias; su alcance para GA4 con este marco es una
  cuestión de **revisión legal**.
- **Política de privacidad.** Debe reescribirse antes de cargar nada:
  responsable e contacto, finalidades, base legal, destinatarios (Google, y
  Sentry y Firebase Performance si siguen), transferencias, plazos de
  conservación, derechos y cómo retirar el consentimiento. Hoy
  (`legal.ts:136-148`) no cubre eso.
- **Sentry y Firebase Performance.** Hoy corren sin consentimiento
  (apartado «Qué corre hoy»). Si deben pasar por la misma puerta depende de
  si se consideran estrictamente necesarios: **revisión legal**. Este ADR no
  las mueve; la pregunta queda abierta (Pregunta 4).
- **Menores y datos sensibles.** Los eventos son privados y no entran en la
  analítica; no se prevé más análisis aquí. **Revisión legal** si el público
  incluye menores.

### 4. Relación con D9 (`?cta=`)

D9 se reabre y se propone **sí**: `?cta=hero` y `?cta=closing` (valores
cerrados, no texto libre). Razones: sin un manejador de clic en la landing, es
la única forma de distinguir CTA sin añadir más JavaScript; el parámetro
llega al `page_view` de `/app/login` como parte de la URL; no es un dato de la
persona. Condiciones: la aplicación ignora parámetros desconocidos; solo se
cuenta si la persona aceptó (sin consentimiento, el parámetro viaja pero nadie
lo lee); el valor no se propaga a ningún otro sitio. Alternativa si se prefiere
no tocar la URL: un evento `cta_click` con un parámetro `location`, que exige
JavaScript de clic en la landing (más peso, ver más abajo). Compatible con D8
(`?mode=signup`). **Verificar** que `page_location` conserva el parámetro en
GA4 y que la SPA registra `page_view` también al navegar dentro de `/app`
(el 0009 lo da por hecho).

### 5. Relación con el 0009

Este ADR **enmienda** el 0009; no lo supersede ni lo edita. Lo que cambia: (a)
la analítica pasa a correr también en las páginas públicas; (b) se cargará
solo con consentimiento previo, en landing y en app (el 0009 no definía
consentimiento: solo un aviso); (c) se reabre el «Los cinco eventos, y no más»
en lo mínimo: ningún evento nuevo con nombre, pero sí `page_view` en la
landing y el parámetro `cta`. Lo que no cambia: Firebase Analytics, los cinco
eventos de producto, nunca contenido del usuario, degradación silenciosa con
bloqueadores, CSP sin `doubleclick.net`. Al aceptarse, se actualiza la fila
del 0009 en el índice a «Enmendado por 0017» y se corrige la spec (supuestos 4
y 5, secciones 7 y 8, D6, D9).

## Rendimiento y CSP

- **JavaScript.** Imprescindible para guardar y leer la elección y para cargar
  GA tras aceptar. No puede ir en línea: la CSP no admite `unsafe-inline` en
  `script-src` (`firebase.json:50`). Propuesta de presupuesto, **a medir**
  antes de aprobarlo: un único script propio, ≤ 3 KB sin comprimir, con
  `defer`; 1 petición más; **0 orígenes ajenos hasta aceptar**. El presupuesto
  de la spec (sección 8) pasa de «0 B» a «≤ 3 KB propios, 0 B de terceros
  antes de consentir».
- **Origen externo.** Tras aceptar, `googletagmanager.com` (cargador de GA) y
  `google-analytics.com` / `analytics.google.com` (medición). Tamaño del
  cargador: **verificar** midiendo. Se carga con el mismo patrón que Sentry:
  después del primer pintado y en reposo (`afterMainPaint`, `sentry/index.ts:38-44`),
  nunca durante el LCP. Para una primera visita, que aún no ha aceptado,
  el coste de terceros es cero.
- **LCP.** El candidato a LCP es la imagen del hero, no el banner; el banner
  debe ir en posición fija sobre el contenido para no mover el diseño
  (**CLS 0** se mantiene) y su texto no debe ser el mayor elemento pintado.
  **Verificar** con Lighthouse (mediana de 5 pasadas, móvil, producción) con
  banner y sin él, y de nuevo cuando se sustituya el hero por las
  ilustraciones con IA: la línea base actual no sirve para esa imagen.
- **Visitantes recurrentes que ya aceptaron**: sí cargan GA en cada visita;
  es el único caso donde la landing paga el origen ajeno. Se mide aparte.
- **Sin JavaScript.** Quien navega sin JS nunca ve el banner y nunca se mide:
  coherente con la privacidad por defecto.
- **CSP.** Sin cambios necesarios en las directivas de GA: ya están
  (`firebase.json:50`) y valen para la landing. Dos matices: (a) la cabecera es
  única para toda la web, así que la landing ya *permite* orígenes que no usa
  hasta aceptar; separar una cabecera más estricta para la landing es posible
  (`headers` por `source`) y queda como opción; (b) el script propio sale de
  `'self'`, no requiere hash. **Verificar** los hosts reales de Firebase
  Performance e Installations frente a `https://*.googleapis.com`.
- **Pruebas.** El e2e que exige 0 `<script>` ejecutables (`landing.spec.ts:97`)
  cambia: pasa a exigir *un script propio*, ninguno de terceros antes de
  aceptar y el tope de bytes. Hace falta un e2e nuevo con consentimiento
  denegado (no se envía nada a `google-analytics.com`/`googletagmanager.com`)
  y otro aceptado.

## Alternativas consideradas

1. **No medir la landing (statu quo del 0009).** Cero riesgo legal nuevo y
   presupuesto intacto. Solo da el numerador (`page_view` de `/app/login` con
   referrer de la landing), sin visitas ni tasa de clic; y ese `page_view` ya
   corre sin consentimiento, que es lo que hay que revisar de todos modos.
   Descartada porque el responsable pidió medir todo; es el *fallback* si la
   revisión legal desaconseja el consentimiento.
2. **Medición del lado servidor.** No existe: no hay Cloud Functions ni
   servicio propio (0007), y Hosting no ofrece analítica por persona ni por
   ruta más allá de uso agregado (**verificar**). Construirla es
   infraestructura nueva, contraria a la preferencia del proyecto (0009).
3. **Analítica sin cookies** (Umami Cloud, Plausible, Umami autohospedado,
   las que el 0009 ya evaluó). Evita la mayor parte del banner y el sesgo de
   selección, y dejaría la landing más ligera (script pequeño). Costes: un
   origen nuevo, otra cuenta, y el propietario descartó explícitamente esta
   vía en el 0009. Si la autoridad o el criterio legal aceptan medir
   audiencia sin consentimiento con herramientas exentas (**revisión legal**;
   **verificar** condiciones de la CNIL y de la AEPD), la opción merece
   reabrirse: mediría el 100 % del tráfico. Pregunta 1.
4. **GA4 cargado siempre en la landing, con el aviso informativo.** Mide al
   100 %, mantiene la UX actual; incompatible con el consentimiento previo que
   pide el responsable y con el art. 22.2 LSSI-CE. Descartada.
5. **GA4 con modo de consentimiento en «denegado» y pings sin cookies.**
   Recupera parte de los datos sin aceptación, pero envía igualmente peticiones
   a Google con la IP. No es la base por defecto (ver 2).

## Consecuencias

**Positivas**

- El embudo completo (visita → CTA → registro → primer evento) pasa a ser
  medible, y el CTA del hero se distingue del del cierre.
- Una sola puerta de consentimiento, compartida por landing y app, que
  también corrige el hueco actual en la app (GA arranca sin aceptar).
- Sin proveedor ni dependencia nuevos; la CSP no cambia.
- La landing sigue ligera para quien no acepta: 0 orígenes ajenos.

**Negativas**

- Primer JavaScript de la landing: ≤ 3 KB y una petición, y una excepción al
  e2e «sin JavaScript» y a la spec (sección 8).
- Las cifras del embudo estarán sesgadas hacia quien acepta; sin esa
  proporción, no hay denominador fiable.
- Hay que reescribir la política de privacidad y mantener el banner
  (retirada, caducidad, texto por idioma). Es trabajo legal y de copy, no
  solo de código.
- Si la revisión legal exige poner Sentry y Firebase Performance tras la
  misma puerta, se pierde cobertura de errores y rendimiento real para quien
  rechace.
- Tendrá que medirse de nuevo el LCP con banner y con las ilustraciones nuevas
  del hero.

## Preguntas abiertas para el responsable

1. ¿Se acepta que sin consentimiento la landing **no se mide** y que las tasas
   del embudo son solo de quien acepta? ¿O se prefiere una herramienta
   exenta de consentimiento (alternativa 3) para tener el 100 % del
   tráfico, aun con un proveedor nuevo?
2. ¿Hay presupuesto y plazo para una **revisión legal** (RGPD/LSSI-CE) antes de
   publicar? ¿Quién es el responsable del tratamiento y qué dirección de
   contacto va en la política? Sin eso, ¿se mantiene el statu quo (alternativa 1)?
3. ¿Se acepta un único script propio de ≤ 3 KB en la landing (excepción al «sin
   JavaScript»), o se prefiere un banner sin JavaScript aunque no pueda
   guardar la elección?
4. ¿Sentry y Firebase Performance deben pasar por la misma puerta de
   consentimiento, aun perdiendo cobertura de errores y de rendimiento real
   de quien rechace?
5. ¿D9 (`?cta=hero` / `?cta=closing`) se aprueba como parámetro de URL, o se
   prefiere un evento `cta_click` con su JavaScript?
6. ¿Qué es el KPI principal: `sign_up`, o `first_event_created`? (Por la
   incoherencia entre el puerto, el 0009 y el código, hay que fijar también qué
   cuenta como «primer evento».)
7. ¿Aceptar durante la visita a la landing vale también para la aplicación,
   y por cuánto tiempo caduca la elección?
8. ¿Se puede activar ya el consentimiento en la **aplicación**, aunque la
   landing espere? Hoy GA arranca sin aceptar allí.
9. ¿Se confirma que `VITE_FIREBASE_MEASUREMENT_ID` y `VITE_SENTRY_DSN` están
   definidos en producción, y en qué región está Sentry?
10. Las ilustraciones del hero (generadas con IA) no afectan a la analítica, pero
    sí a la línea base de LCP: ¿se miden de nuevo antes de fijar el
    presupuesto?

## Verificación (cuando se implemente)

- Unitarios del adaptador: no inicializa GA sin consentimiento, lo detiene al
  retirarlo, sigue tragando fallos y bloqueadores.
- E2E de la landing: sin consentimiento, cero peticiones a
  `googletagmanager.com` y `google-analytics.com`, un único script propio,
  banner con dos botones del mismo peso; con consentimiento, `page_view`.
- Lighthouse (mediana de 5 pasadas, móvil, producción): LCP, CLS 0 y peso con
  y sin banner.
- La aplicación ignora `?cta=` desconocidos; `test:arch` en verde.

## Enlaces

- [0009 · Analítica de activación](0009-analitica-de-activacion.md)
- [Spec de la landing](../spec-landing-registro.md), secciones 7, 8 y 17
- [Línea base de rendimiento](../perf/2026-08-16-linea-base.md)
- CSP: `firebase.json`
