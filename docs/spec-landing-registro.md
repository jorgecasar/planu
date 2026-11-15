# Spec: una landing que invita a registrarse (GH-271)

Estado: **borrador para revisión humana**. No hay código de landing cambiado.
La crítica que lo motiva está en
[`landing-revision-diseno.md`](landing-revision-diseno.md). Nada de esto se
implementa hasta que el responsable apruebe la spec y resuelva las
«Decisiones del responsable» del final.

## 1. Objetivo

**Que una persona que llega por primera vez entienda qué es planu en cinco
segundos y tenga una razón concreta para crear una cuenta.**

- Usuario: quien organiza eventos propios (cenas, quedadas, reuniones, planes de
  grupo) y quiere guardarlos en privado y compartirlos con gente concreta.
- «Entender en cinco segundos»: en la primera pantalla, sin hacer scroll, a
  390×844 y a 1280×800, se leen (1) qué es (un planificador de eventos), (2) la
  diferencia (privado, compartes con quien eliges) y (3) una única acción:
  **Crea tu cuenta**.
- «Razón para registrarse»: cada beneficio de la página es una función que
  existe hoy en el código (tabla de trazabilidad, sección 5), y el producto real
  se ve en capturas de la aplicación, no en dibujos.
- Éxito, medible sin recolección nueva (sección 7): sube la proporción de
  entradas a `/app/login` que llegan desde la landing y terminan en `sign_up`.
  Esta spec no fija una cifra objetivo: hoy no hay línea base (F14 de la
  revisión).

### Supuestos (corregidme ahora o sigo con ellos)

1. La landing sigue siendo HTML prerrenderizado sin JavaScript, sin elementos
   personalizados ni interacciones en cliente. Sólo CSS.
2. La identidad es la del ADR 0008: Belleza en 400 para titulares, Alegreya para
   cuerpo, índigo, tema `wa-theme-planu`. Se personaliza el **tema**
   (`apps/web/src/styles/theme-planu.css`), nunca se renombran ni reimplementan
   clases `wa-*`.
3. Todo texto va por `msg()` y existe en español y en inglés.
4. No se añade ningún rastreador ni dato nuevo recolectado (ADR 0009).
5. «Gratis» y «sin anuncios» se mantienen porque ya están publicados y el repo
   no tiene ni precios ni anuncios; confirmarlo es la decisión D7.
6. El registro es con correo y contraseña o con Google
   (`session-adapter.ts:120`, `:150`); quien usa correo debe verificarlo para
   usar la app (ADR 0011).

## 2. Comandos

```
Construir la landing:     npm run build:landing
Servir dist/:             node scripts/serve-dist.js 4173
E2E de la landing:        npm run test:e2e:landing
Lint y tipos:             npm run lint && npm run typecheck && npm run lint:lit
Textos nuevos:            npm run localize:extract  (traducir <target>)
                          npm run localize:build
                          npx @biomejs/biome check --write apps/web/src/generated/locales/
Arquitectura:             npm run test:arch
Semilla de la cuenta:     npm run seed          (emuladores ya levantados)
```

Cada comando se juzga por su código de salida, no por su salida (`AGENTS.md`).

## 3. Estructura de la página, sección a sección

Una columna, centrada, `max-width` del tema. Orden y copy exactos. Todo texto es
una cadena `msg()`; el español es la fuente de verdad de la propuesta.

### 3.0 Cabecera (nueva)

`<header>` con el logo de planu (enlace a la portada del idioma) y, a la derecha,
**«Entrar»** / **«Sign in»**: un enlace de texto con `a.wa-button.wa-plain`
(existe en `native.css`), no un botón de marca. Va a `/app/login`.

### 3.1 Hero

| | Español | English |
| --- | --- | --- |
| h1 | Planifica tus eventos. Compártelos solo con quien tú elijas. | Plan your events. Share them only with the people you choose. |
| Subtítulo | Guarda cada evento con su lugar, sus fechas, sus etiquetas y su imagen. Es privado hasta que invitas a alguien como lector o como editor. | Save each event with its place, dates, tags and image. It stays private until you invite someone as a viewer or an editor. |
| CTA primario | **Crea tu cuenta** | **Create your account** |
| Microcopia | Con tu correo o con Google. Gratis y sin anuncios. | With your email or Google. Free, no ads. |
| Imagen | Captura real de la lista de eventos (sección 6) | igual, capturada en inglés |
| `alt` | Lista de eventos de planu con título, fecha, lugar y etiquetas | planu event list with title, date, place and tags |

Un solo botón de acción. `wa-heading-4xl` para el h1 (existe), subtítulo en
`wa-body-l`. Tracking del titular más cerrado en el tema, no en la landing.
La captura **no** debe quedar cortada por el pliegue en 390: va con su texto
legible (sección 6) o va debajo del CTA a ancho completo sin forzar la altura.

### 3.2 Qué puedes hacer (cuatro beneficios)

h2: **Qué puedes hacer con planu** / **What you can do with planu**.
Cuatro tarjetas (clase propia, no `wa-card`), una por función, cada una con su
icono en línea. Orden de mayor a menor peso para el registro.

| # | Título ES / EN | Texto ES | Texto EN |
| --- | --- | --- | --- |
| 1 | Privado hasta que tú digas / Private until you say so | Tus eventos son solo tuyos. Solo los ve quien tú invites. | Your events are yours alone. Only the people you invite can see them. |
| 2 | Lector o editor, tú eliges / Viewer or editor, you choose | Invita por correo y decide si cada persona solo mira o también edita. Quien invitas necesita una cuenta de planu y acepta la invitación. Puedes quitarle el acceso cuando quieras. | Invite by email and decide whether each person only views or can also edit. Anyone you invite needs a planu account and accepts the invitation. You can remove their access at any time. |
| 3 | De un cartel o un texto al evento / From a poster or a text to an event | Sube la foto de un cartel o pega un anuncio y planu rellena el evento. Tú lo revisas antes de guardarlo. Funciona en navegadores con IA integrada, como Chrome de escritorio, y la lectura se hace en tu dispositivo. | Upload a photo of a poster or paste an announcement and planu fills in the event. You review it before saving. It works in browsers with built-in AI, such as desktop Chrome, and the reading happens on your device. |
| 4 | A tu calendario / To your calendar | Descarga un evento, o tu agenda filtrada, como archivo .ics. Un evento suelto también se añade a Google Calendar con un clic. | Download an event, or your filtered agenda, as an .ics file. A single event can also be added to Google Calendar with one click. |

### 3.3 Cómo empezar (tres pasos, secuencia real: aquí sí va numeración)

h2: **Cómo empezar** / **How to start**.

| Paso | ES | EN |
| --- | --- | --- |
| 1. Crea tu cuenta | Con tu correo o con Google. Si usas correo, confírmalo desde el mensaje que te enviamos. | With your email or Google. If you use email, confirm it from the message we send you. |
| 2. Añade tu primer evento | Escríbelo a mano o, si tu navegador lo permite, deja que la IA lo lea. Título, lugar, fechas con o sin hora, hasta 10 etiquetas y una imagen. | Write it by hand or, if your browser allows it, let the AI read it. Title, place, dates with or without a time, up to 10 tags and an image. |
| 3. Compártelo o llévatelo | Invita a otras personas como lector o editor, o descárgalo a tu calendario. | Invite others as viewers or editors, or download it to your calendar. |

### 3.4 Tus eventos, tus reglas (privacidad y compartir)

h2: **Tus eventos, tus reglas** / **Your events, your rules**. Tres filas
(clase `wa-stack`), sin tarjetas:

| Rol | ES | EN |
| --- | --- | --- |
| Tú | Lees, editas, invitas, quitas el acceso y borras el evento. | You read, edit, invite, remove access and delete the event. |
| Editor | Lee y edita el contenido. No invita ni borra. | Reads and edits the content. Can't invite or delete. |
| Lector | Solo lee. | Only reads. |

Línea final: «Cualquiera puede salir de un evento que le han compartido, y tú
puedes borrar tu cuenta cuando quieras.» / «Anyone can leave an event shared
with them, and you can delete your account whenever you want.»

### 3.5 Cierre

h2: **Empieza con tu primer evento** / **Start with your first event**.
Mismo CTA primario **Crea tu cuenta** / **Create your account**. Debajo:
«¿Ya tienes cuenta? Entrar» / «Already have an account? Sign in»
(enlace de texto, `/app/login`).

### 3.6 Pie

Privacidad · Términos · Contacto (los tres con objetivo táctil de al menos 44 px
de alto), «© 2026 planu» (año en una constante, no en el XLIFF), y el aviso de
cookies sujeto a la decisión D6. Se corrige además la errata «Mantenlos» →
«Manténlos».

### Lo que se retira

Las dos tarjetas «Pega texto → evento» (se funde en la 3), «Organiza con
etiquetas» (pasa a una línea del paso 2), el h2 «¿Por qué planu?», «Tres cosas
que hacemos diferente», «Tus datos son tuyos», «Sin invitaciones pendientes»,
«recibes un enlace de registro», «Apple Calendar, Outlook» y «en segundos».

## 4. Estrategia de la llamada a la acción

- **Una sola acción primaria**: «Crea tu cuenta» / «Create your account». Botón
  `a.wa-button.wa-brand.wa-size-l`. Aparece dos veces: hero y cierre.
- **«Empezar a planificar» desaparece.** Prometía un uso sin cuenta que no
  existe: `/app` redirige al acceso.
- **«Entrar» deja de ser botón**: enlace de texto en la cabecera (siempre
  visible, es el sitio convencional) y en el cierre («¿Ya tienes cuenta?»). Nunca
  compite con el CTA en la primera pantalla.
- **Destino**: hoy `/app/login` abre la pestaña «Entrar» (F1). El CTA debe caer
  en «Crear cuenta»: hace falta un enlace profundo (`/app/login?mode=signup`) que
  active esa pestaña. Eso toca `apps/web/src/auth/login-view.ts` (fuera de la
  landing): rodaja 6, y decisión D8 sobre si se acepta tocar la app. Mientras no
  exista, el CTA apunta a `/app/login` y se dice en la PR.
- Sin urgencia falsa, sin contadores, sin «únete a miles». Ningún dato de uso.

## 5. Trazabilidad: toda afirmación, con su evidencia

| Afirmación del copy | Evidencia en el repo |
| --- | --- |
| Los eventos son privados; solo los ve quien invitas | `firestore.rules`; ADR 0002, ADR 0006 |
| Roles lector y editor; el dueño invita, quita y borra; el editor no invita ni borra | ADR 0006, tabla de roles; `sharing/share-dialog.ts:166-167` |
| Quien invitas necesita cuenta y acepta | ADR 0012 («They join once they accept it»); ADR 0011 |
| Se puede quitar el acceso / cancelar la invitación | `sharing/access-rows.ts:109` |
| Cualquiera puede salir de un evento compartido | ADR 0006, `leavesTheEvent()` |
| Borrar la cuenta | `profile/profile-view.ts:157`, `AccountDataPort` |
| Foto o texto a evento, revisado antes de guardar, en el dispositivo, solo con IA integrada | `events/ai-event-generator.ts:181,225`; ADR 0003; `domain/ai-policy.ts:38` |
| `.ics` de un evento o de la agenda filtrada; Google Calendar solo para un evento | `events/calendar-export.ts:134,139,212` |
| Fechas con o sin hora, hasta 10 etiquetas, imagen | ADR 0010; `domain/tags.ts:12`; `lib/types.ts` |
| Correo o Google; correo verificado | `infrastructure/firebase/session-adapter.ts:120,134,150`; ADR 0011 |
| Español e inglés | `domain/pick-locale.ts` |
| Gratis, sin anuncios | **Sin evidencia de precio ni de anuncios; decisión D7** |

Regla para el checker: una frase del copy sin fila en esta tabla es un fallo.

## 6. Capturas del producto real

La mejor prueba es la aplicación. Se pueden capturar con la cuenta sembrada
(`npm run seed`, `scripts/seed-emulator.js`) y los emuladores, que ya corren.

| Pantalla | Para qué sección | Cómo | Pendiente |
| --- | --- | --- | --- |
| Lista de eventos | Hero | App en 1280 y 390, en español y en inglés | La semilla pone `imageUrl: ""` (`seed-emulator.js:218`): sin portadas. Hace falta una semilla de capturas con imágenes subidas al emulador de Storage y **con licencia propia**; las fotos de `hero.webp` no tienen procedencia documentada |
| Diálogo de compartir con Lector/Editor | Beneficio 2 y reglas | Capturar el diálogo abierto | Dos cuentas semilla para que haya filas de acceso reales |
| Editor con «Rellenar con IA» | Beneficio 3 | Chrome con Gemini Nano | Una máquina con IA integrada: en Chromium headless el panel no se ofrece |
| Menú de exportar | Beneficio 4 | Capturar el desplegable (.ics, Google Calendar) | — |
| Calendario mensual | Opcional | Vista de calendario | — |

Cómo llegan optimizadas a la página, sin dependencias nuevas:

1. Script de captura con Playwright (ya en el repo) que fija viewport, idioma
   (`navigator.languages`), tema claro y hora/fechas relativas a la semilla.
2. Redimensionar y convertir con `cwebp` o `magick` (instalados en la máquina; no
   entran en `package.json`; el comando exacto se documenta en el script).
3. Un archivo por pantalla e idioma en `apps/web/public/assets/landing/`, con
   `width` y `height` declarados (CLS 0), `loading="lazy"` y `decoding="async"`
   salvo la del hero, que lleva `fetchpriority="high"`.
4. En 390 se sirve un recorte vertical propio (no la misma imagen reducida):
   las tarjetas de la captura de escritorio quedan ilegibles a 219 px de alto.
5. `og.png` se regenera aparte (hoy sin las tipografías, ADR 0008).

Sin pie de foto bajo las imágenes; `alt` descriptivo y traducido.

## 7. Medición, sin rastreadores nuevos

Lo que hay: el adaptador de analítica de la aplicación (ADR 0009,
`infrastructure/firebase/analytics-adapter.ts`) registra `sign_up`,
`first_event_created`, `share` y `ai_used`, más el `page_view` automático. La
landing no ejecuta JavaScript, así que **no mide nada** y no se le añade nada.

Qué se puede medir con lo que existe:

| Pregunta | Cómo | Límite |
| --- | --- | --- |
| ¿Cuánta gente pasa de la landing al acceso? | En GA4, `page_view` de `/app/login` cuyo `page_referrer` es `/es/` o `/en/` (el navegador lo envía; el SDK lo recoge solo) | Es el numerador del primer paso, no la audiencia de la landing |
| ¿Cuántas cuentas se crean? | Evento `sign_up` | No dice de qué página venían |
| ¿Activan? | `first_event_created` frente a `sign_up` | Ya existe |
| ¿Llegan a compartir o usar IA? | `share`, `ai_used` | Ya existen |
| ¿Qué CTA convierte (hero o cierre)? | Opcional, decisión D9: distinguir el origen con un parámetro en el enlace (`?cta=hero` / `?cta=final`), que el `page_view` ya recoge en su URL | Cambia la URL que ve la app; la app debe ignorarlo; no es dato nuevo de la persona |

Lo que **no** se puede saber sin un rastreador: el número de visitas a la
landing (denominador). No se propone cubrirlo. Alternativas sin script en la
página: Search Console para la búsqueda orgánica, o las métricas de ancho de
banda de Hosting, que cuentan peticiones, no personas.

Importante: el aviso de cookies de la landing hoy describe un tratamiento que
esa página no hace (D6).

## 8. Presupuesto de rendimiento

Línea base medida (revisión, tabla de números): 6 peticiones, 288 924 B sin
comprimir, 12,7 KB de HTML, 0 B de JavaScript, 0 orígenes ajenos, CLS 0.

Presupuesto propuesto (recuentos, no puntuaciones, como pide `AGENTS.md`):

| Medida | Hoy | Presupuesto |
| --- | --- | --- |
| JavaScript | 0 B | **0 B** (el único `<script>` sigue siendo el JSON-LD) |
| Orígenes ajenos al cargar | 0 | **0** |
| HTML con CSS en línea, por idioma | 12,7 KB | **≤ 18 KB** (el tope del build de 24 KB se mantiene) |
| CSS propio en línea | no medido por separado | **≤ 5 KB** (medirlo al empezar la rodaja 1) |
| Peticiones por encima del pliegue | 6 | **≤ 8** |
| Bytes de la primera pantalla (HTML, CSS, fuentes, hero), sin comprimir | ~289 KB | **≤ 300 KB** |
| Cada captura | 54 KB | **≤ 60 KB** (webp) |
| Total de la página con tres capturas diferidas | — | **≤ 480 KB** |
| Fuentes | 2 archivos | **2 archivos** (sin caras nuevas, ADR 0016) |
| CLS | 0 | **0** |
| LCP | sin medida fiable | mediana de 5 pasadas de Lighthouse móvil en producción, **≤ 2,5 s**; no se acepta n = 1 |

El build ya hace fallar si el HTML supera 24 KB (`build-landing.js:52`). Se
propone además una aserción en el e2e de la landing con el tope de 18 KB y otra
con el peso de cada imagen, para que el presupuesto no dependa de la buena
voluntad.

## 9. Movimiento, solo CSS

Marco: `emil-design-eng` y `find-animation-opportunities`. La landing se ve una
vez, así que cabe una entrada; nada que se repita ni que se mueva con el scroll.

Seguro en Baseline *widely available* (política de `AGENTS.md`): `@keyframes` y
`animation`, `transition`, `transform`/`opacity`, `@media (prefers-reduced-motion)`.
Se evitan los que, según nuestro conocimiento a fecha de esta spec, aún no lo
son: `@starting-style`, `animation-timeline: scroll()`/`view()`, view
transitions y `content-visibility`. **Antes de usar cualquiera, comprobar su
estado Baseline actual**: la guía `motion` de `modern-web-guidance` recomienda
varios de ellos y su versión instalada está desactualizada.

| Candidato | Puerta | Veredicto |
| --- | --- | --- |
| Entrada única del hero (titular, subtítulo y CTA aparecen con `opacity` y `translate` de 8 px) | Frecuencia rara; propósito: guiar la mirada a la acción | **Sí.** 400 ms, `cubic-bezier(0.23, 1, 0.32, 1)`, escalonado de 60 ms, dentro de `@media (prefers-reduced-motion: no-preference)`; sin esa media, el contenido está en su estado final |
| Respuesta al pulsar los CTA (`scale(0.97)` a 160 ms) | Feedback | **Sí**, tras `@media (hover: hover) and (pointer: fine)` para el hover y sin él para `:active`; sobre una clase propia (`cta`), no redefiniendo `.wa-button` |
| Revelar cada sección al hacer scroll | Frecuencia rara, pero sin propósito que no sea adorno | **No** (patrón de plantilla; además requiere scroll-driven) |
| Paralaje en la captura | Decoración | **No** |
| Elevar las tarjetas al pasar el ratón | No son enlaces | **No** |
| Bucles (iconos, degradados) | Más de 5 s sin pausa (WCAG 2.2.2) | **No** |
| Contador o sellos animados | Dato inventado | **No** |
| Transición entre idiomas | No hay JS | **No** |

Con movimiento reducido no hay entrada: sólo queda la transición de color de los
botones (la de `native.css`). Nada queda oculto en ningún caso.

## 10. Estructura del código y estilo

```
apps/web/src/landing/landing.ts       plantilla (hero, beneficios, pasos, reglas, cierre, pie)
apps/web/src/landing/landing.css      estilos propios; sólo tokens --wa-*, sin valores en crudo
apps/web/src/landing/legal.ts         pie compartido: año y aviso (D6)
apps/web/src/styles/theme-planu.css   tracking y escala del titular (se personaliza el tema)
apps/web/public/assets/landing/       capturas webp por idioma
apps/web/xliff/es.xlf                 traducciones nuevas
apps/web/e2e-landing/landing.spec.ts  e2e de la landing
scripts/build-landing.js              presupuestos; sin cambios de lógica salvo el tope
```

Reglas: comentarios en inglés, docs en español, commits en inglés (Conventional
Commits). Antes de usar una clase `wa-*`: `grep -r <clase>
node_modules/@awesome.me/webawesome/dist/styles/`. Los valores crudos de
`landing.css` (`4.5rem`, `64rem`, `42rem`, `17rem`) se sustituyen por tokens al
tocar esas reglas. Un solo `:root`: nada de pisar tokens desde fuera del tema.

## 11. Estrategia de pruebas

Los e2e de la landing corren contra `dist/` (nunca contra `npm run dev`). Se
mantienen: axe a cero en `/`, `/en/` y `/es/`; ningún `<script>` salvo JSON-LD;
página visible con JS apagado; clases `wa-*` existentes en el CSS del paquete;
estilos calculados del hero, botones y rejilla.

Cambian, porque nombran lo que se retira: los que buscan el enlace
«Start planning» (`landing.spec.ts` líneas 62-66 y 85-87), los que cuentan seis
`svg.feature-icon` y seis `.feature-card` (líneas 90 y 399-401) y los de estilo
de botones que comparan primario y secundario. Nuevos:

- Una acción primaria: exactamente un `a.wa-button.wa-brand` por pantalla visible
  y su texto es «Create your account» / «Crea tu cuenta».
- La primera pantalla a 390×844 y 1280×800 contiene h1 y CTA (caja del CTA
  dentro del viewport).
- Reflujo a 320 px: `scrollWidth <= clientWidth` (cierra F8; hoy falla).
- Objetivos táctiles de enlaces y botones de al menos 44 px de alto.
- Movimiento: con `reducedMotion: "reduce"` ninguna animación en marcha y nada
  con `opacity: 0`; con `no-preference`, la entrada termina y deja todo visible.
- Presupuesto: HTML ≤ 18 KB por idioma; cada imagen ≤ 60 KB; ningún origen ajeno
  entre las peticiones.
- Las capturas existen, con las medidas que declaran y en el idioma de la página.

Cada aserción nueva se rompe a propósito para comprobar que puede fallar
(`AGENTS.md`: «un test que no puede fallar es peor que ninguno»).

## 12. Límites

**Siempre**: texto por `msg()` en es y en; cada frase con su fila de la tabla 5;
axe a cero; cero JavaScript; presupuesto de la sección 8; foco visible; commits
atómicos de menos de 200 líneas con su verificación.

**Preguntar antes**: tocar `login-view.ts` o la app (D8); cambiar el aviso de
cookies (D6); añadir cualquier parámetro a los enlaces (D9); usar fotos sin
licencia clara; añadir herramientas de imagen al repo.

**Nunca**: cifras de usuarios, testimonios, valoraciones, logos de terceros,
«visto en», urgencia falsa, funciones que la app no tiene; renombrar o
reimplementar clases `wa-*`; JavaScript, elementos personalizados o analítica en
la landing; cambiar la identidad del ADR 0008; añadir una entrada a la lista de
exenciones de `biome.json` ni subir el tope de ficheros acoplados.

## 13. Criterios de éxito

1. En 390×844 y 1280×800, la primera pantalla muestra el h1, el subtítulo y el
   CTA «Crea tu cuenta» sin scroll (test).
2. Una sola acción primaria visible por pantalla (test).
3. Cada afirmación del copy está en la tabla 5 con evidencia; el checker la
   revisa frase a frase.
4. `npm run build:landing`, `test:e2e:landing`, `lint`, `typecheck`, `lint:lit`
   y `test:arch` salen con 0.
5. axe a cero; reflujo a 320 px sin scroll horizontal; objetivos de 44 px.
6. Presupuesto de la sección 8 cumplido, comprobado con recuentos y, en
   producción, con la mediana de cinco pasadas de Lighthouse.
7. Español e inglés completos; el XLIFF sin mensajes desfasados.

## 14. Rodajas de trabajo (máximo 200 líneas cada una)

Cada rodaja la hace un maker en su rama, la revisa un checker con contexto
nuevo y no abre PR hasta converger (`AGENTS.md`, «Trabajar en loops»). Orden por
dependencia.

| # | Rodaja | Líneas aprox. | Pruebas | Foco del checker |
| --- | --- | --- | --- | --- |
| 1 | **Hero, cabecera y CTA.** Cabecera con «Entrar»; h1, subtítulo y CTA únicos; quitar «Empezar a planificar»; errata y año; `landing.css` mínimo y reflujo a 320 px (`minmax(min(…, 100%), 1fr)`). El CTA apunta a `/app/login`. XLIFF. | 150 | Cambian los e2e que nombran «Start planning»; nuevos: una acción primaria, primera pantalla, reflujo 320 | Que cada frase esté en la tabla 5; que no queden `wa-*` inventadas; que el contenido no dependa de JS; que «Entrar» no compita con el CTA |
| 2 | **Cuatro beneficios.** Sustituir las seis tarjetas por cuatro, con iconos en línea (se conservan cuatro de los seis). | 120 | Los conteos de iconos y tarjetas pasan a cuatro; axe | Los textos de las tarjetas 2 y 3 (invitación con aceptación; IA condicionada); que no se prometa lo retirado en F4 |
| 3 | **Pasos y reglas.** Secciones 3.3 y 3.4. | 140 | axe, orden de encabezados | Que la tabla de roles coincida con el ADR 0006; que «borrar la cuenta» exista |
| 4 | **Capturas reales.** Script de captura, semilla de capturas con imágenes con licencia, webp por idioma, `<img>` con medidas. Recortes móviles. | 180 (más binarios) | Existencia, medidas declaradas, peso ≤ 60 KB, idioma | Procedencia de cada imagen; que el hero no sea LCP con `loading="lazy"`; que no haya texto en inglés en `/es/`; sin datos reales en las capturas |
| 5 | **Cierre, pie y movimiento.** Sección 3.5, pie con 44 px, entrada del hero y respuesta al pulsar. | 150 | Movimiento reducido y normal, objetivos táctiles | Que con movimiento reducido no quede nada oculto; que no se reimplemente `.wa-button` |
| 6 | **Enlace profundo al alta y medición.** `?mode=signup` activa la pestaña «Crear cuenta» en `login-view.ts`; el CTA apunta ahí; parámetro de origen si se decide D9. Fuera de la landing. | 80 | Unitario de `login-view`; e2e del flujo | Que la app ignore parámetros desconocidos; que no se envíe ningún dato nuevo; `test:arch` en verde |

Tras la 6, una pasada de `/ship` (`code-reviewer`, `security-auditor` solo si se
tocó la app, `test-engineer`) y Lighthouse (mediana de cinco) en el despliegue.

## 15. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| «Solo los ve quien tú invites» es exacto para el texto del evento; la URL de la imagen lleva un token portador y quien la tenga la ve sin sesión (`AGENTS.md`, «Estado de seguridad») | El copy no afirma que las imágenes sean inaccesibles; D5 decide si la página lo menciona; la política de privacidad debería decirlo |
| La IA solo funciona en navegadores con IA integrada: una promesa fuerte genera frustración | El beneficio 3 lo dice y el paso 2 la deja como opcional |
| Invitar a quien no tiene cuenta no avisa a nadie (ADR 0012, consecuencia b) | El copy dice que la persona necesita cuenta; hay que reabrir el asunto en producto, no maquillarlo en la landing |
| El CTA cae en la pestaña «Entrar» si no llega la rodaja 6 | Se declara en la PR; no bloquea las demás |
| Capturas con datos de semilla o fotos con derechos dudosos | Semilla de capturas propia, imágenes con licencia propia; el checker pide la procedencia |
| Cuentas de correo sin verificar quedan bloqueadas (ADR 0011) | El paso 1 lo avisa |
| Superar el presupuesto con las capturas | Tope por imagen y total, comprobado en el e2e |
| El año del pie vuelve a quedarse viejo | Una constante, no texto en el XLIFF |
| Copy en español más largo rompe botones o titulares a 320 px | Prueba de reflujo y de la primera pantalla en los dos idiomas |
| Lighthouse con n = 1 «demuestra» cualquier cosa | Mediana de cinco o recuentos |

## 16. Decisiones del responsable

Nada de esto lo decide esta spec. Con la recomendación del revisor.

| # | Decisión | Opciones | Recomendación |
| --- | --- | --- | --- |
| D1 | **Tono de voz** | (a) Directo y práctico, como en la spec; (b) cálido, con personalidad; (c) mantener el estilo de eslogan corto actual | (a). El eslogan actual no dice qué es planu (F2); la calidez puede vivir en la microcopia. Tuteo («tú») en español |
| D2 | **Titular** | (a) «Planifica tus eventos. Compártelos solo con quien tú elijas.»; (b) conservar «Tus eventos. Privados. Compartibles. Tuyos.» y añadir una línea que nombre la categoría; (c) otro | (a): nombra la categoría y la diferencia en una frase |
| D3 | **Demo de la importación con IA** | (a) Solo capturas del editor; (b) un vídeo corto; (c) nada de IA en la primera pantalla | (a) en el beneficio 3, no en el hero. (b) añade peso y puede enseñar algo que muchos navegadores no darán |
| D4 | **Qué capturas** | La lista de eventos en el hero y el diálogo de compartir en el beneficio 2 como mínimo; calendario opcional | Lista (hero), compartir (beneficio 2), menú de exportar (beneficio 4). Con semilla propia e imágenes con licencia propia |
| D5 | **¿Pide el registro antes o después de enseñar el producto?** | (a) Producto primero y registro después (esta spec: CTA en el hero y repetido al final); (b) registro inmediato, sin enseñar nada; (c) una demo sin cuenta (no existe y exigiría producto nuevo) | (a). Y decidir si la página menciona que las URL de imagen llevan token portador |
| D6 | **Aviso de cookies en el pie de la landing** | (a) Mantenerlo; (b) quitarlo de la landing y dejarlo solo en la app, donde sí corre la analítica; (c) conservarlo solo en las páginas legales | (b), con revisión legal: la landing no ejecuta analítica. Hasta decidirlo, se mantiene |
| D7 | **«Gratis» y «sin anuncios»** | Mantener, quitar, o matizar si habrá planes de pago | Mantener si es cierto hoy. El repo no tiene precios ni anuncios; confirmarlo con producto |
| D8 | **Tocar la app para el enlace profundo al alta** (`login-view.ts`) | Sí (rodaja 6) o no (el CTA cae en «Entrar») | Sí: sin él, el CTA «Crea tu cuenta» abre la pestaña equivocada |
| D9 | **Distinguir el CTA del hero del del cierre** (`?cta=`) | Sí o no | No al inicio: dos CTA con la misma etiqueta y un solo destino bastan; añadirlo cuando haya volumen |
| D10 | **Cabecera** con «Entrar» | Sí, una cabecera mínima; o solo el enlace del cierre | Sí |
| D11 | **FAQ** con `<details>` nativo (¿navegadores de la IA?, ¿qué pasa si invito a alguien sin cuenta?) | Añadirlo, o dejarlo fuera de esta entrega | Fuera de esta entrega. Si se añade, que cada respuesta tenga su fila en la tabla 5 y sin prometer lo que ADR 0012 reconoce que no funciona |
| D12 | **Qué hacer con la invitación a quien no tiene cuenta** | Dejarlo como está; o abrir una tarea de producto para que el alta reclame las ofertas | Abrir tarea de producto: es lo que más se parece a una promesa rota |
| D13 | **Modo oscuro** de la landing | La página fija `wa-light`; el ADR 0008 prevé oscuro | Fuera de esta entrega |
| D14 | **Procedencia de las fotos actuales de `hero.webp`** | Confirmar licencia o sustituirlas | Sustituirlas por capturas con imágenes propias (rodaja 4) |

## 17. Decisiones del responsable (2026-11-15)

Respuestas del responsable a las decisiones D1 a D14. Donde difieren de la
recomendación del revisor, esta sección manda sobre la tabla de la sección 16.

| # | Decisión | Respuesta | Efecto en la spec |
| --- | --- | --- | --- |
| D1 | Tono | **Cálido, con personalidad** (no la recomendación) | El copy de la sección 3 se reescribe en un tono más cercano, conservando una fila de trazabilidad por frase y sin prometer nada que el producto no haga |
| D2 | Titular | «Planifica tus eventos. Compártelos solo con quien tú elijas.» | Se mantiene; hay que encajarlo con el tono de D1 |
| D3 | Demo de IA | Solo capturas del editor, sin vídeo | Como recomendado |
| D4 | Capturas | Lista (hero), compartir (beneficio 2), exportar (beneficio 4) | Como recomendado |
| D5 | Orden del registro | Producto primero, registro después | Como recomendado |
| D6 | Aviso de cookies en la landing | **Mantenerlo** (no la recomendación) | Se queda; ver «Analítica» |
| D7 | «Gratis» y «sin anuncios» | **Quitar** | Se retiran del copy y de la tabla de trazabilidad (sección 5) |
| D8 | Enlace profundo al alta | Sí, tocar `login-view.ts` | Rodaja 6, aparte y sin cambios visuales |
| D9 | `?cta=` | No (recomendado), **a revisar con la analítica nueva** | Ver «Analítica» |
| D10 | Cabecera con «Entrar» | Sí | Como recomendado |
| D11 | FAQ | Fuera de esta entrega | Como recomendado |
| D12 | Invitación a quien no tiene cuenta | Abrir tarea de producto para que el alta reclame las ofertas | Issue nueva, enlazada desde esta spec |
| D13 | Modo oscuro | Fuera de esta entrega | Como recomendado |
| D14 | Fotos del hero | Están **generadas con IA** (Gemini / Imagen, de Google) | Ver «Imágenes» |

### Analítica en todas las páginas (cambio de alcance)

El responsable quiere medir todo, incluida la landing. Esto contradice los
supuestos 4 y 5 de la sección 1 (sin rastreadores nuevos, ADR 0009) y el
presupuesto de la sección 8 (0 B de JavaScript, sin orígenes de terceros).
Esta spec no lo resuelve; lo deja como trabajo previo a la rodaja de
medición:

- Concretar qué analítica corre hoy en la app y si envía datos a terceros.
- El aviso de cookies mantenido (D6) pasa a ser necesario: la analítica no debe
  cargar hasta aceptar, y hay que decir qué se puede medir sin consentimiento.
- Un ADR nuevo o una enmienda del ADR 0009, y revisar la política de privacidad.
- Reabrir el presupuesto de rendimiento (JavaScript y origen externo) y su efecto
  en LCP.
- Definir qué es una conversión: visita a la landing, clic en el CTA (hero y
  cierre), registro y primer evento creado. Con eso se reabre D9 (`?cta=`).
- Riesgos RGPD (IP, identificadores, base legal): lo que requiera revisión legal
  queda marcado como tal.

### Imágenes generadas con IA (D14)

No hay licencia de terceros que confirmar, pero queda por comprobar y anotar:

- Las condiciones de uso comercial de la herramienta de Google que las generó.
- Que no se presenten como capturas reales del producto: la sección 6 habla de
  capturas de la app real, y las del hero no lo son.
- Si conviene indicar que son ilustraciones generadas con IA.
- Que no muestren menores reconocibles ni texto en inglés dentro de `/es/`.
