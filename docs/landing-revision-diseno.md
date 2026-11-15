# Revisión de diseño de la landing (GH-271)

Fase 1 de GH-271: crítica de lo que hay publicado, sin tocar código de la
landing. La propuesta que sale de aquí está en
[`spec-landing-registro.md`](spec-landing-registro.md).

Encargo del responsable: revisar la landing con las skills de diseño del repo y
llegar a una página que haga querer registrarse. Todo lo medido está sin
tocar: `dist/` construido con `npm run build:landing` desde `origin/main` y
servido con `scripts/serve-dist.js`.

## Método y límites de la medición

- Navegador: Chromium headless de Playwright, 390×844 (móvil con táctil) y
  1280×800, más 320×640 para el reflujo. axe-core se inyectó en la página
  pintada, sin filtrar etiquetas.
- El MCP `chrome-devtools` no estaba disponible en el contexto del agente, así
  que **no hay pasada de Lighthouse**. LCP y CLS salen de `PerformanceObserver`
  en una sola carga contra `localhost`: el LCP absoluto (28–72 ms) no vale como
  cifra de producción y no se usa como tal. Lo determinista, como pide
  `AGENTS.md`, son los recuentos: bytes, peticiones, orígenes, posiciones.
- Capturas en la carpeta de trabajo del agente, fuera del repo (no se
  versionan): `es-390-fold`, `es-390-full`, `es-1280-fold`, `es-1280-full`,
  `en-390-fold`, `en-390-full`, `en-1280-fold`, `en-1280-full`, `es-320-fold`,
  `en-320-fold` (todas `.png`) y `measures.json` con los números en bruto.

## Skills aplicadas

Sólo las que se cargaron y se usaron. De cada una, qué se aplicó y un hallazgo.

| Skill | Qué se aplicó | Hallazgo concreto |
| --- | --- | --- |
| `impeccable` | Modo *Persuade* (la landing es una superficie para decidir y actuar) y la regla «la marca manda»: la identidad del ADR 0008 no se toca. No se ejecutó su lanzador de contexto ni sus referencias `critique`/`audit`: sólo los principios de `SKILL.md`. | F1: «Empezar a planificar» y «Entrar» llevan al mismo sitio y los dos son botones de marca del mismo tamaño; no hay una acción primaria. |
| `frontend-design` | «Abre con lo más característico del sujeto» y la lista de defectos de plantilla. | F5: seis tarjetas idénticas con el mismo peso, el patrón «kit SaaS» que la skill señala como valor por defecto. |
| `design-taste-frontend` | Sólo sus reglas de contenido y de plan para una página de software (el h1 nombra la categoría y a quién, un dato duro en la primera pantalla, una acción principal, nada inventado). Su cadena de herramientas (`gate.mjs`, capa de movimiento, efectos) **no** se usó: exige JavaScript y la landing no lo carga. | F2: el h1 («Tus eventos. Privados. Compartibles. Tuyos.») no dice qué es planu; ni «planificador» ni «app» aparecen en la primera pantalla salvo en el subtítulo. |
| `webawesome-design` | Paso 0 (la landing es piezas sueltas, no `<wa-page>`: no hay JS), la escalera «componente, utilidad, token, API de estilo» y la regla 5 (nada de valores en crudo). | F11: `landing.css` fija `4.5rem`, `64rem`, `42rem` y `17rem` en crudo y estiliza por selector de elemento (`.features > div`). |
| `webawesome` | Comprobar que cada clase propuesta existe en los CSS del paquete (`grep` sobre `dist/styles/`): `wa-heading-4xl`, `wa-body-*`, `wa-stack`, `wa-grid`, `wa-split`, `wa-flank`, `wa-frame`, `wa-cluster`, `a.wa-button` con `wa-brand`/`wa-plain`/`wa-outlined`. | No hay clases `wa-card`, `wa-callout` ni `wa-details` en `dist/styles/`: sin JS no hay componentes, así que las tarjetas siguen siendo clase propia. Y `native.css` sí estiliza `<details>`/`<summary>` (líneas 452-536): un FAQ sin JS es posible con HTML nativo. |
| `emil-design-eng` | Marco de decisión de movimiento (frecuencia, propósito, curva, duración) y el pie de componentes: respuesta al pulsar. | F13: los CTA sólo tienen la transición de color de 75 ms de `native.css`; sin respuesta al pulsar ni entrada. Una landing se ve una vez: es el nivel de frecuencia que admite una entrada. |
| `apple-design` | Fundamentos (propósito, simplicidad, responsabilidad con la privacidad) y tipografía (tracking y interlineado por tamaño). | F10: el h1 de 41 px va con el tracking y el interlineado por defecto; un titular de display pide tracking negativo y más tamaño. Y el mensaje de privacidad, que es lo que vende planu, está escondido en la tarjeta 1 de 6. |
| `break-ui` | Datos y entornos en el peor caso realista: 320 px de ancho, texto en español (más largo), JavaScript apagado, movimiento reducido, foco por teclado. | F8: a 320 px hay scroll horizontal (`scrollWidth` 344 frente a 320 de ancho). axe no lo ve. |
| `modern-web-guidance` | Guía `motion` (`npx modern-web-guidance retrieve motion`): patrón `prefers-reduced-motion: no-preference` para animar sólo cuando se pide. Su versión instalada está desactualizada (2026_09_04 frente a 2026_11_09): conviene actualizarla. | Recomienda animaciones ligadas al scroll; contradice la política de `AGENTS.md` (sólo Baseline *widely available*), así que la spec las descarta. |
| `find-animation-opportunities` | La puerta de cuatro preguntas (frecuencia, propósito, velocidad, función) para decidir qué se anima. | De ocho candidatos sobreviven dos (entrada única del hero y respuesta al pulsar los CTA); se rechazan seis (ver la spec, «Movimiento»). |
| `spec-driven-development` | Estructura de la spec (objetivo, comandos, estructura, pruebas, límites, criterios de éxito). | — |

No se usaron `animate`, `choreograph` ni `review-animations`: no hay animación
que construir ni revisar todavía.

## Lo que hace hoy la landing

Una página prerrenderizada con `@lit-labs/ssr` (`apps/web/src/landing/landing.ts`),
sin JavaScript (el único `<script>` es el JSON-LD), con el tema `wa-theme-planu`.
Dos secciones y un pie:

1. **Hero**: logo de 72 px, h1 «Tus eventos. Privados. Compartibles. Tuyos.»,
   subtítulo, dos botones (`Empezar a planificar` → `/app`, `Entrar` →
   `/app/login`), «Gratis. Sin anuncios. Tus datos son tuyos.» y una captura
   (`hero.webp`, 1200×675).
2. **«¿Por qué planu?»** con «Tres cosas que hacemos diferente» y **seis**
   tarjetas: privado, compartir, calendario, foto a evento, texto a evento,
   etiquetas.
3. **Pie**: Privacidad · Términos · Contacto, © 2025, aviso de cookies.

Ni cabecera, ni pasos, ni segundo CTA, ni cierre.

### Números medidos (una carga, sin caché)

| | ES | EN |
| --- | --- | --- |
| HTML con CSS en línea | 12 752 B (tope 24 576) | 12 596 B |
| Peticiones | 6 | 6 |
| Bytes transferidos, sin comprimir | 288 924 | 288 768 |
| Desglose (ES, 1280) | HTML 12 752 · hoja Web Awesome 93 540 · `hero.webp` 54 198 · Alegreya 111 648 · Belleza 16 044 · logo 742 | igual |
| JavaScript | 0 (sólo JSON-LD) | 0 |
| Orígenes ajenos | 0 | 0 |
| CLS | 0 | 0 |
| Palabras visibles | 254 | 253 |
| Alto del documento | 2 233 px (1280) · 3 104 px (390) | 2 233 px · 2 962 px |
| axe | 0 violaciones, 25 reglas pasadas, en 390 y 1280 de los dos idiomas | igual |

Primera pantalla:

| Viewport | h1 | CTA primario (y, alto) | Inicio de la captura | ¿Qué se ve de la captura? |
| --- | --- | --- | --- | --- |
| 1280×800 | 2 líneas, 41 px, Belleza 400 | 374 px, 54 px alto; dentro del pliegue | 541 px | Los primeros 259 px: fotos y títulos de las tarjetas; fechas, lugares y etiquetas quedan abajo |
| 390×844 ES | 4 líneas, 41 px | 537 px (y el secundario a 604 px) | 771 px | 73 px: sólo miniaturas |
| 390×844 EN | 4 líneas | 456 px | 622 px | Entera, pero a 219 px de alto el texto de las tarjetas mide unos 4 px: ilegible |

Contraste y objetivos táctiles: texto del botón primario 6,87:1, secundario
13,24:1, texto atenuado más bajo 6,30:1 (todos por encima de AA 4,5:1). Botones
de 213×54 y 96×54 px (ES). Enlaces del pie de 22 px de alto y 14 px de cuerpo.
Orden de encabezados h1, h2, h3 sin saltos. Anillo de foco de 3 px, visible.
Con `prefers-reduced-motion: reduce` sólo queda la transición de color de los
botones (permitida).

## Qué funciona

- La identidad del ADR 0008 está aplicada de verdad: h1 en Belleza 400, cuerpo en
  Alegreya, botón `rgb(63, 81, 181)`, tema `wa-theme-planu`. Medido con
  `getComputedStyle`, no leído.
- Rendimiento base excelente: 12,7 KB de HTML, cero JavaScript, cero orígenes
  ajenos, CLS 0, fuentes precargadas, imagen con `width`/`height`.
- Accesibilidad base limpia: axe a cero, un `<main>`, contraste por encima de
  AA, foco visible, botones de 54 px de alto.
- Bilingüe de verdad: dos páginas con `hreflang`, título y descripción
  traducidos, JSON-LD.
- El pie y el aviso de cookies cumplen con ADR 0009 y las páginas legales
  existen en los dos idiomas.
- Los CSS de Web Awesome se usan tal cual (botones `a.wa-button`, utilidades de
  texto y layout): no hay clases `wa-*` inventadas.

## Qué falla, por impacto en el registro

Orden: lo que más frena que alguien cree una cuenta, primero.

### F1. No hay una acción de registro (skill: `impeccable`)

`/app` y `/app/login` terminan en la misma pantalla: `guardRedirect` manda a
`LOGIN_PATH` a quien no tiene sesión (`apps/web/src/auth/guard.ts:36-37`), y la
pantalla abre en la pestaña «Entrar» (`apps/web/src/auth/login-view.ts:129-131`,
sin `active`), no en «Crear cuenta». «Empezar a planificar» no promete registro
y lleva a un formulario de acceso; no hay forma de enlazar a la pestaña de
alta. Los dos botones comparten tamaño y color de marca (uno relleno, otro
contorno), así que la jerarquía de acción no existe.

### F2. El titular no dice qué es planu (skills: `design-taste-frontend`, `frontend-design`)

Cuatro fragmentos de una palabra («Privados. Compartibles. Tuyos.») suenan bien
y no nombran nada: ni evento, ni planificar, ni para quién. A los cinco
segundos, una persona nueva sólo ha leído «Tus eventos» y tres adjetivos. El
subtítulo lo aclara, pero es un cuerpo de 20 px en gris atenuado.

### F3. La prueba del producto llega tarde, pequeña y en otro idioma (skills: `frontend-design`, `break-ui`)

La captura empieza a 541 px en escritorio y a 771 px en el móvil ES; en 390
queda a 219 px de alto y es ilegible. En la página en español, la captura
enseña «Dinner with Sarah», «Edit», «Share» y «Sat, Oct 12, 7PM» en inglés: el
`alt` está traducido y la imagen no. Es la única prueba visual de la página y
es la que menos se puede leer justo donde más gente llega (móvil).

### F4. Afirmaciones del copy que el código no respalda (skill: `design-taste-frontend`, «nada se inventa»)

| Frase actual | Estado | Evidencia |
| --- | --- | --- |
| «Acceden al instante si tienen cuenta, o reciben un enlace de registro si no. Sin invitaciones pendientes» | **Falsa en dos mitades** | No se envía ningún correo de invitación (no hay servidor; `session-adapter.ts` sólo llama a `sendEmailVerification`). Sí hay invitaciones pendientes: ofertas en `eventInvitesByEmail` y estado «pending» (`sharing/access-rows.ts:109`, «Cancel invitation»). El reclamo automático «es hoy un no-op» (ADR 0012, consecuencia b). La invitación se acepta, no es «al instante» («They join once they accept it», ADR 0012) |
| «Foto → evento en segundos», «la misma IA» | **Incompleta** | Sólo funciona con IA integrada del navegador (Chrome de escritorio con requisitos de disco y RAM, ADR 0003); la nube está cerrada (`domain/ai-policy.ts:38`, `CLOUD_LOCKED = true`). Si el navegador no la trae, la opción no se ofrece |
| «Tres cosas que hacemos diferente» con seis tarjetas | Incoherente | `landing.ts:150` |
| «Se abre en Apple Calendar, Google Calendar, Outlook» | **No verificada** | Hay `.ics` (`events/calendar-export.ts:134`) y enlace a Google Calendar sólo para un evento (`calendar-export.ts:139`, `:212`); abrirlo en Apple o Outlook no se ha probado (`AGENTS.md`: «abrir un `.ics` en una aplicación real» no lo cierra un agente) |
| «Tus datos son tuyos» | Vaga | No dice nada comprobable. Lo concreto sí existe: borrar la cuenta (`profile/profile-view.ts:157`) y salir de un evento compartido (ADR 0006) |
| «Gratis. Sin anuncios» | Plausible | No hay precios ni código de anuncios en el repo; `jsonLd` declara `price: "0"`. Es una decisión de producto (ver spec) |
| «Hasta 10 etiquetas… colores estables derivados del nombre» | Verdadera | `domain/tags.ts:12` (`MAX_TAGS = 10`) y el hash FNV de `:110` |
| «© 2025» | Desactualizada | Hoy es 2026 y las páginas legales dicen «22 agosto 2026» |

Una persona que se registra esperando un enlace de invitación a un amigo sin
cuenta se encuentra con que no pasa nada. Es el hallazgo con más riesgo de
confianza: se arregla quitando la frase, no maquillándola.

### F5. Seis tarjetas idénticas diluyen lo único que vende (skills: `frontend-design`, `design-taste-frontend`, `apple-design`)

Seis cajas redondeadas iguales, mismo icono, mismo peso. Lo que distingue a
planu —privado por defecto y compartir con rol— ocupa dos de seis; etiquetas y
«pegar texto» son detalles. Los títulos van en 20 px, el mismo cuerpo que el
subtítulo del hero: no hay jerarquía entre «lo central» y «lo accesorio».

### F6. La página acaba sin una última acción (skill: `impeccable`, modo Persuade)

Tras la rejilla vienen el pie y el aviso de cookies. Quien llega abajo, en el
móvil ES tras 3 104 px, no tiene un botón al alcance. No hay segundo CTA.

### F7. Sin cabecera: ni marca persistente ni «Entrar» (skill: `apple-design`, familiaridad)

La persona que ya tiene cuenta debe leer el hero para encontrar «Entrar», que
además compite con el CTA primario. Un enlace de acceso discreto arriba a la
derecha es la convención que cualquiera espera.

### F8. A 320 px hay scroll horizontal (skill: `break-ui`)

`scrollWidth` 344 con 320 de ancho. El culpable es `.features > div` (344 px):
`minmax(17rem, 1fr)` más el padding horizontal del contenedor
(`landing.css:88` y `:17`). Incumple el reflujo de WCAG 1.4.10 a 320 px y axe
no lo detecta. Arreglo: `minmax(min(17rem, 100%), 1fr)`.

### F9. Erratas y datos viejos (skill: `break-ui`, revisión del peor caso de copy)

«Mantenlos privados» → «Manténlos privados» (hero ES). «© 2025 planu» en los
dos idiomas.

### F10. Jerarquía tipográfica tímida (skill: `apple-design`, `frontend-design`)

h1 a 41 px con tracking cero; el h2 de sección a 32 px y los h3 a 20 px. Entre
el titular y el resto hay poca diferencia de peso visual y el titular, de dos
líneas en escritorio, no domina la pantalla. Se corrige con un salto de escala
(`wa-heading-4xl`, existe en `utilities/text.css`) y tracking más cerrado en el
tema, no con clases inventadas.

### F11. CSS propio con valores en crudo (skill: `webawesome-design`)

`4.5rem`, `64rem`, `42rem`, `17rem`: regla 5 («nunca valores en crudo»). Selectores
de elemento (`.features > div`, `.hero > div`) acoplan estilo a estructura.
No afecta al registro, pero conviene limpiarlo al tocar esas reglas.

### F12. Pie con objetivos táctiles pequeños y un aviso que no aplica (skills: `break-ui`, lectura de ADR 0009)

Los tres enlaces del pie miden 22 px de alto (por debajo de 24 px de WCAG 2.5.8 y
muy lejos de 44 px). Y el aviso de cookies dice que planu usa Firebase Analytics
al venir de una página que **no ejecuta ningún script de analítica** (la
landing no carga JavaScript): ruido legal en la página que más tiene que
convencer. Es decisión del responsable (ver spec).

### F13. Sin movimiento intencional (skills: `emil-design-eng`, `find-animation-opportunities`, `modern-web-guidance`)

No hay animación en la página: sólo la transición de color de 75 ms de los
botones. Una landing se ve una vez (frecuencia «rara», la que admite una
entrada) y los CTA no tienen respuesta al pulsar.

### F14. Hoy no se puede medir la landing (lectura de ADR 0009, `analytics-adapter.ts`)

El adaptador de analítica vive en la aplicación; la landing no ejecuta JS, así
que no hay `page_view` de la portada ni forma de saber cuánta gente llega. El
embudo empieza en `/app/login`.

## Lo que no se pudo comprobar

- Lighthouse y el LCP de producción: sin MCP de DevTools; ver el método.
- Abrir un `.ics` en Apple Calendar u Outlook (`AGENTS.md`: nunca lo cierra un
  agente).
- La procedencia y licencia de las fotos de `hero.webp`: parecen fotografías de
  archivo; el commit `096b74a` sólo dice «real hero screenshot». Hay que
  confirmarlo antes de reutilizarlas (ver spec, decisiones).
- El comportamiento de la IA en el dispositivo: la captura del editor con el
  panel «Rellenar con IA» exige un Chrome con Gemini Nano.
